"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { saveFile } from "@/lib/storage";
import {
  channelFor,
  chatSide,
  getTeamChannel,
  parseConversation,
  recordChatRead,
  requireChatViewer,
  type ChatViewer,
} from "@/lib/chat";
// Writing the message, marking it read and telling people lives in chat-send,
// shared with the mobile API: a server action cannot be called by the phone
// app, and a second copy of that sequence would drift from this one.
import { postChatMessage } from "@/lib/chat-send";
import { askAssistant } from "@/lib/ai/assistant";
import type { ChatMessageKind } from "@/generated/prisma/enums";

// Posting to a conversation: the team's, or a private one between two people.
// Both portals call these. The author is always taken from the session, never
// from the form, and the conversation the form names is only ever opened
// through channelFor, which refuses anyone it is not theirs.

function refresh() {
  revalidatePath("/admin/chat", "layout");
  revalidatePath("/employee", "layout");
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

  // No page redraw. Every open chat receives this over its live stream, and
  // the sender's screen already shows it; redrawing the whole conversation on
  // the server before replying is what made sending feel slow.
  //
  // The sender's screen swaps its pending copy for what comes back.
  return postChatMessage(viewer, conversation, channel.id, {
    kind,
    body: body || null,
    attachmentUrl,
    attachmentName,
    attachmentType,
    attachmentSize,
    durationSeconds,
    projectId,
  });
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
