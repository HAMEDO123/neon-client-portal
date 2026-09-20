import { prisma } from "@/lib/db";
import { messageSelect, recordChatRead, type ChatViewer, type Conversation } from "@/lib/chat";
import { adminChatUrl, employeeChatUrl, otherPeer } from "@/lib/chat-conversations";
import { managerEmployeeId } from "@/lib/manager-account";
import { dispatchNotification } from "@/lib/notifications/engine";
import { chatCopy, chatKey, chatPreview } from "@/lib/notifications/types";
import { avatarUrl } from "@/lib/avatar";
import type { ChatMessageKind } from "@/generated/prisma/enums";

// What happens when a message is posted, wherever it was posted from.
//
// This used to live inside `sendChatMessage`, which is a server action and so
// reachable only from the web app. The phone app cannot call a server action —
// they are build-tied RPC, not an API — so the mobile routes would have needed
// their own copy of "create the row, mark the conversation read, tell the
// people who are not looking at it".
//
// A second copy is how the studio ended up with twenty-five drifting copies of
// the admin guard and eleven of a refresh helper. So the core lives here, in a
// plain module, and both callers use it: a message sent from a phone is created,
// read and notified exactly as one sent from a browser.
//
// Not "use server": every export of one of those is callable over the network,
// and this trusts its caller to have resolved the viewer and opened the channel.

/** The author, taken from the session — never from anything the client sent. */
function authorFields(viewer: ChatViewer) {
  return {
    authorType: viewer.type,
    authorId: viewer.type === "EMPLOYEE" ? viewer.id : null,
    authorName: viewer.name,
  };
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
async function notifyOfMessage(messageId: string, sender: ChatViewer, conversation: Conversation, preview: string) {
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

export type PostedMessage = {
  kind: ChatMessageKind;
  body: string | null;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentType?: string | null;
  attachmentSize?: number | null;
  durationSeconds?: number | null;
  projectId?: string | null;
};

/**
 * Writes a message into a channel the caller has already opened.
 *
 * The caller resolves the viewer and passes the channel `channelFor` gave them,
 * which is the access check — nothing here re-derives who may post where.
 */
export async function postChatMessage(
  viewer: ChatViewer,
  conversation: Conversation,
  channelId: string,
  input: PostedMessage
) {
  const message = await prisma.chatMessage.create({
    select: messageSelect,
    data: {
      channelId,
      ...authorFields(viewer),
      kind: input.kind,
      body: input.body,
      attachmentUrl: input.attachmentUrl ?? null,
      attachmentName: input.attachmentName ?? null,
      attachmentType: input.attachmentType ?? null,
      attachmentSize: input.attachmentSize ?? null,
      durationSeconds: input.durationSeconds ?? null,
      projectId: input.projectId ?? null,
    },
  });

  // Posting counts as having read everything before it.
  await recordChatRead(viewer, channelId);

  // Telling people runs on its own: awaiting it would make the sender wait on
  // every device's push, and a failure must never cost the message.
  void notifyOfMessage(
    message.id,
    viewer,
    conversation,
    chatPreview(input.kind, input.body, input.durationSeconds ?? null, input.attachmentName ?? null)
  );

  return message;
}
