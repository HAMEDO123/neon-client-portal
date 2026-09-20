import { prisma } from "@/lib/db";
import { saveFile } from "@/lib/storage";
import {
  channelFor,
  messageSelect,
  parseConversation,
  recordChatRead,
  type ChatViewer,
  type Conversation,
} from "@/lib/chat";
import { adminChatUrl, employeeChatUrl, otherPeer } from "@/lib/chat-conversations";
import { managerEmployeeId } from "@/lib/manager-account";
import { dispatchNotification } from "@/lib/notifications/engine";
import { chatCopy, chatKey, chatPreview } from "@/lib/notifications/types";
import { avatarUrl } from "@/lib/avatar";
import type { ChatMessageKind } from "@/generated/prisma/enums";

// Posting a message, for the web action and the mobile API both.
//
// This used to live inside `sendChatMessage` in lib/actions/chat-actions.ts,
// which is a "use server" module reading FormData out of a browser request and
// its author out of a cookie. The app has neither — a Bearer token and JSON —
// and the part that must not be written twice is underneath both: who the
// message reaches. `notifyOfMessage` decides that the team group never pushes
// to the manager, that a private message to them does, that a chat between two
// employees tells only the other one. A second copy of those rules on the
// mobile side would be the copy nobody reads, and the way it would fail is
// silence — somebody simply not told, with nothing on any screen to say so.
//
// Not "use server": every export of one of those is callable over the network,
// and this takes a viewer as an argument. Handing it one would be handing it
// anybody's identity.

function authorFields(viewer: ChatViewer) {
  return {
    authorType: viewer.type,
    authorId: viewer.type === "EMPLOYEE" ? viewer.id : null,
    authorName: viewer.name,
  };
}

/**
 * The conversation a caller names, opened for this viewer. A page opened
 * before private chats existed names none, and means the team.
 *
 * `channelFor` is the access check, and it is the only one: a viewer who is not
 * in the conversation gets nothing back and this throws.
 */
export async function openConversation(viewer: ChatViewer, named: string | null) {
  const conversation = parseConversation(named || "team", viewer);
  const channel = conversation ? await channelFor(viewer, conversation) : null;
  if (!conversation || !channel) throw new Error("That conversation is not yours to post in.");
  return { conversation, channel };
}

export type ChatMessageInput = {
  body?: string;
  projectId?: string | null;
  photo?: File | null;
  voice?: File | null;
  document?: File | null;
  durationSeconds?: number | null;
};

/**
 * Writes the message, marks the conversation read, and tells whoever it is for.
 *
 * Returns null when there was nothing to write — no text and no attachment —
 * rather than creating an empty row.
 */
export async function postChatMessage(
  viewer: ChatViewer,
  named: string | null,
  input: ChatMessageInput
) {
  const { conversation, channel } = await openConversation(viewer, named);

  const body = (input.body ?? "").trim().slice(0, 4000);
  const projectId = input.projectId || null;
  const durationRaw = Number(input.durationSeconds ?? 0);

  let kind: ChatMessageKind = "TEXT";
  let attachmentUrl: string | null = null;
  let attachmentName: string | null = null;
  let attachmentType: string | null = null;
  let attachmentSize: number | null = null;
  let durationSeconds: number | null = null;

  const { photo, voice, document } = input;

  if (voice instanceof File && voice.size > 0) {
    const saved = await saveFile(voice, "chat/voice", "audio", false);
    kind = "VOICE";
    attachmentUrl = saved.url;
    attachmentName = "Voice message";
    attachmentType = saved.fileType;
    attachmentSize = saved.fileSize;
    durationSeconds = Number.isFinite(durationRaw) && durationRaw > 0 ? Math.round(durationRaw) : null;
  } else if (photo instanceof File && photo.size > 0) {
    const saved = await saveFile(photo, "chat/photos", "image");
    kind = "IMAGE";
    attachmentUrl = saved.url;
    attachmentName = photo.name || "Photo";
    attachmentType = saved.fileType;
    attachmentSize = saved.fileSize;
  } else if (document instanceof File && document.size > 0) {
    const saved = await saveFile(document, "chat/files", "document");
    kind = "FILE";
    attachmentUrl = saved.url;
    attachmentName = document.name || "File";
    attachmentType = saved.fileType;
    attachmentSize = saved.fileSize;
  }

  // Nothing to say and nothing attached — do not write an empty row.
  if (kind === "TEXT" && !body) return null;

  const message = await prisma.chatMessage.create({
    select: messageSelect,
    data: {
      channelId: channel.id,
      ...authorFields(viewer),
      kind,
      body: body || null,
      attachmentUrl,
      attachmentName,
      attachmentType,
      attachmentSize,
      durationSeconds,
      projectId,
    },
  });

  // Posting counts as having read everything before it.
  await recordChatRead(viewer, channel.id);

  // Telling people runs on its own: awaiting it would make the sender wait on
  // every device's push, and a failure must never cost the message.
  void notifyOfMessage(
    message.id,
    viewer,
    conversation,
    chatPreview(kind, body, durationSeconds, attachmentName)
  );

  return message;
}

/**
 * The sender's face, as far as a notification can carry one: their initials on
 * their colour. Android and desktop draw it where WhatsApp puts a photo; an
 * iPhone draws the app's own icon on every web notification and ignores it.
 */
async function senderIcon(sender: ChatViewer) {
  if (sender.type === "EMPLOYEE" && sender.id) {
    const row = await prisma.employee.findUnique({ where: { id: sender.id }, select: { color: true } });
    return avatarUrl(sender.name, row?.color);
  }
  return avatarUrl(sender.name, "ink");
}

/** Somebody to tell, and which portal their link belongs to. */
type Recipient = { id: string; isManager?: boolean };

/** The manager as a recipient, or nobody when this studio has no manager row. */
async function managerRecipient(): Promise<Recipient[]> {
  const id = await managerEmployeeId();
  return id ? [{ id, isManager: true }] : [];
}

/**
 * In-app and push, to whoever the conversation is for: the rest of the team
 * for the group; the employee, for the manager's private message to them; the
 * other one, in a chat between two employees; and the manager, for a private
 * message written to them — which reached nobody until they had an employee
 * row to address, and waited silently in their chat list instead.
 *
 * The team group is deliberately not pushed to the manager. They are in every
 * one of them, so it would put the whole studio's chatter on their phone; the
 * list and its sound are the right weight for that.
 */
async function notifyOfMessage(
  messageId: string,
  sender: ChatViewer,
  conversation: Conversation,
  preview: string
) {
  try {
    const recipients: Recipient[] =
      conversation.kind === "team"
        ? await prisma.employee.findMany({
            where: {
              active: true,
              accessRole: "EMPLOYEE",
              ...(sender.type === "EMPLOYEE" ? { NOT: { id: sender.id } } : {}),
            },
            select: { id: true },
          })
        : conversation.kind === "peer"
          ? sender.type === "EMPLOYEE"
            ? [{ id: otherPeer(conversation, sender.id) }]
            : []
          : sender.type === "ADMIN"
            ? [{ id: conversation.employeeId }]
            : // An employee writing to the manager. This was an empty list for as
              // long as the manager had no employee row to address; they have one
              // now, so their phone hears about a private message like everyone
              // else's. Still empty when there is no such row — a message that
              // was sent is sent either way.
              await managerRecipient();
    if (recipients.length === 0) return;

    const copy = chatCopy(sender.name, preview);
    const icon = await senderIcon(sender);

    await Promise.all(
      recipients.map((recipient) =>
        dispatchNotification({
          employeeId: recipient.id,
          type: "CHAT_MESSAGE",
          title: copy.title,
          message: copy.message,
          url: recipient.isManager ? adminChatUrl(conversation) : employeeChatUrl(conversation, recipient.id),
          icon,
          // One notification per message per person, so a retry cannot double it.
          dedupeKey: chatKey(messageId, recipient.id),
        }).catch(() => undefined)
      )
    );
  } catch {
    // A message that was sent is sent; telling people is best effort.
  }
}
