"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { saveFile } from "@/lib/storage";
import {
  channelFor,
  chatSide,
  getTeamChannel,
  messageSelect,
  parseConversation,
  recordChatRead,
  requireChatViewer,
  type ChatViewer,
  type Conversation,
} from "@/lib/chat";
import { employeeChatUrl } from "@/lib/chat-conversations";
import { askAssistant } from "@/lib/ai/assistant";
import { dispatchNotification } from "@/lib/notifications/engine";
import { chatCopy, chatKey, chatPreview } from "@/lib/notifications/types";
import { avatarUrl } from "@/lib/avatar";
import type { ChatMessageKind } from "@/generated/prisma/enums";

// Posting to a conversation: the team's, or a private one between the manager
// and an employee. Both portals call these. The author is always taken from
// the session, never from the form, and the conversation the form names is
// only ever opened through channelFor, which refuses anyone it is not theirs.

function refresh() {
  revalidatePath("/admin/chat", "layout");
  revalidatePath("/employee", "layout");
}

function authorFields(viewer: ChatViewer) {
  return {
    authorType: viewer.type,
    authorId: viewer.type === "EMPLOYEE" ? viewer.id : null,
    authorName: viewer.name,
  };
}

/**
 * The conversation a form names, opened for this viewer. A page opened before
 * private chats existed names none, and means the team.
 */
async function openConversation(viewer: ChatViewer, named: FormDataEntryValue | string | null) {
  const conversation = parseConversation(typeof named === "string" && named ? named : "team", viewer);
  const channel = conversation ? await channelFor(viewer, conversation) : null;
  if (!conversation || !channel) throw new Error("That conversation is not yours to post in.");
  return { conversation, channel };
}

export async function sendChatMessage(formData: FormData) {
  // The portal the message is sent from says whose session this is.
  const viewer = await requireChatViewer(chatSide(String(formData.get("as") ?? "")));
  const { conversation, channel } = await openConversation(viewer, formData.get("conversation"));

  const body = String(formData.get("body") ?? "").trim().slice(0, 4000);
  const projectId = String(formData.get("projectId") ?? "") || null;
  const photo = formData.get("photo");
  const voice = formData.get("voice");
  const document = formData.get("document");
  const durationRaw = Number(formData.get("durationSeconds") ?? 0);

  let kind: ChatMessageKind = "TEXT";
  let attachmentUrl: string | null = null;
  let attachmentName: string | null = null;
  let attachmentType: string | null = null;
  let attachmentSize: number | null = null;
  let durationSeconds: number | null = null;

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
  if (kind === "TEXT" && !body) return;

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
  // No page redraw. Every open chat receives this over its live stream, and
  // the sender's screen already shows it; redrawing the whole conversation on
  // the server before replying is what made sending feel slow.

  // Telling people runs on its own: awaiting it would make the sender wait on
  // every device's push, and a failure must never cost the message.
  void notifyOfMessage(message.id, viewer, conversation, chatPreview(kind, body, durationSeconds, attachmentName));

  // The sender's screen swaps its pending copy for this.
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

/**
 * In-app and push, to whoever the conversation is for: the rest of the team
 * for the group; the employee, for the manager's private message to them. The
 * manager has no phone registered to push to, so a private message for them
 * waits in their chat list, with its sound, instead.
 */
async function notifyOfMessage(messageId: string, sender: ChatViewer, conversation: Conversation, preview: string) {
  try {
    const recipients =
      conversation.kind === "team"
        ? await prisma.employee.findMany({
            where: {
              active: true,
              accessRole: "EMPLOYEE",
              ...(sender.type === "EMPLOYEE" ? { NOT: { id: sender.id } } : {}),
            },
            select: { id: true },
          })
        : sender.type === "ADMIN"
          ? [{ id: conversation.employeeId }]
          : [];
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
          url: employeeChatUrl(conversation),
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

export async function markChatRead(conversation = "team") {
  const viewer = await requireChatViewer();
  const { channel } = await openConversation(viewer, conversation);
  await recordChatRead(viewer, channel.id);
  refresh();
}

export async function deleteChatMessage(messageId: string) {
  const viewer = await requireChatViewer();

  // An employee may delete only their own message; the manager may delete any.
  const where =
    viewer.type === "ADMIN"
      ? { id: messageId }
      : { id: messageId, authorId: viewer.id, authorType: "EMPLOYEE" as const };

  await prisma.chatMessage.deleteMany({ where });
  refresh();
}

// --- The manager's assistant ------------------------------------------------

/**
 * Only the manager may use the assistant. The question and the answer are both
 * written into the team channel as manager-only messages, so the manager keeps
 * a history of what they asked while the team sees none of it. The assistant
 * reads the team conversation only — never a private one.
 */
export async function askChatAssistant(formData: FormData) {
  const viewer = await requireChatViewer("ADMIN");
  if (viewer.type !== "ADMIN") throw new Error("The assistant is available to the manager only.");

  const question = String(formData.get("question") ?? "").trim().slice(0, 2000);
  if (!question) return;

  const channel = await getTeamChannel();

  await prisma.chatMessage.create({
    data: {
      channelId: channel.id,
      authorType: "ADMIN",
      authorName: viewer.name,
      kind: "TEXT",
      body: question,
      managerOnly: true,
    },
  });

  const result = await askAssistant(question);

  await prisma.chatMessage.create({
    data: {
      channelId: channel.id,
      authorType: "AGENT",
      authorName: "Assistant",
      kind: "TEXT",
      body: result.ok ? result.answer : `⚠ ${result.error}`,
      managerOnly: true,
    },
  });

  refresh();
}
