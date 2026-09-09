"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { saveFile } from "@/lib/storage";
import { getTeamChannel, recordChatRead, requireChatViewer, type ChatViewer } from "@/lib/chat";
import { askAssistant } from "@/lib/ai/assistant";
import { dispatchNotification } from "@/lib/notifications/engine";
import { chatCopy, chatKey, CHAT_PATH } from "@/lib/notifications/types";
import type { ChatMessageKind } from "@/generated/prisma/enums";

// Posting to the team conversation. Both portals call these; the author is
// always taken from the session, never from the form.

function refresh() {
  revalidatePath("/admin/chat");
  revalidatePath("/employee/chat");
  revalidatePath("/employee", "layout");
}

async function authorFields(viewer: ChatViewer) {
  return {
    authorType: viewer.type,
    authorId: viewer.type === "EMPLOYEE" ? viewer.id : null,
    authorName: viewer.name,
  };
}

export async function sendChatMessage(formData: FormData) {
  const viewer = await requireChatViewer();
  const channel = await getTeamChannel();

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
    data: {
      channelId: channel.id,
      ...(await authorFields(viewer)),
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
  await recordChatRead(viewer);
  refresh();

  // Everyone else on the team hears about it. Awaiting this would make the
  // sender wait on every device's push, so it runs on its own and a failure
  // never costs the message.
  void notifyTeamOfMessage(message.id, viewer, previewOf(kind, body));
}

function previewOf(kind: ChatMessageKind, body: string) {
  if (kind === "VOICE") return body || "🎤 Voice message";
  if (kind === "IMAGE") return body || "📷 Photo";
  if (kind === "FILE") return body || "📎 File";
  return body;
}

/** In-app and push, to every active employee except the sender. */
async function notifyTeamOfMessage(messageId: string, sender: ChatViewer, preview: string) {
  try {
    const recipients = await prisma.employee.findMany({
      where: {
        active: true,
        accessRole: "EMPLOYEE",
        ...(sender.type === "EMPLOYEE" ? { NOT: { id: sender.id } } : {}),
      },
      select: { id: true },
    });

    const copy = chatCopy(sender.name, preview);

    await Promise.all(
      recipients.map((recipient) =>
        dispatchNotification({
          employeeId: recipient.id,
          type: "CHAT_MESSAGE",
          title: copy.title,
          message: copy.message,
          url: CHAT_PATH,
          // One notification per message per person, so a retry cannot double it.
          dedupeKey: chatKey(messageId, recipient.id),
        }).catch(() => undefined)
      )
    );
  } catch {
    // A message that was sent is sent; telling people is best effort.
  }
}

export async function markChatRead() {
  await recordChatRead(await requireChatViewer());
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
 * written into the channel as manager-only messages, so the manager keeps a
 * history of what they asked while the team sees none of it.
 */
export async function askChatAssistant(formData: FormData) {
  const viewer = await requireChatViewer();
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
