"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  chatSide,
  getTeamChannel,
  recordChatRead,
  requireChatViewer,
} from "@/lib/chat";
import { openConversation, postChatMessage } from "@/lib/chat-send";
import { askAssistant } from "@/lib/ai/assistant";

// Posting to a conversation: the team's, or a private one between two people.
// Both portals call these. The author is always taken from the session, never
// from the form, and the conversation the form names is only ever opened
// through channelFor, which refuses anyone it is not theirs.

function refresh() {
  revalidatePath("/admin/chat", "layout");
  revalidatePath("/employee", "layout");
}

export async function sendChatMessage(formData: FormData) {
  // The portal the message is sent from says whose session this is.
  const viewer = await requireChatViewer(chatSide(String(formData.get("as") ?? "")));

  const photo = formData.get("photo");
  const voice = formData.get("voice");
  const document = formData.get("document");
  const durationRaw = Number(formData.get("durationSeconds") ?? 0);

  // Everything below the form lives in lib/chat-send.ts, shared with the
  // mobile API: what is written, who is told, and the rules about who counts
  // as a recipient. This end only reads a browser's multipart body.
  //
  // No page redraw. Every open chat receives the message over its live stream,
  // and the sender's screen already shows it; redrawing the whole conversation
  // on the server before replying is what made sending feel slow.
  return postChatMessage(viewer, String(formData.get("conversation") ?? ""), {
    body: String(formData.get("body") ?? ""),
    projectId: String(formData.get("projectId") ?? "") || null,
    photo: photo instanceof File ? photo : null,
    voice: voice instanceof File ? voice : null,
    document: document instanceof File ? document : null,
    durationSeconds: Number.isFinite(durationRaw) ? durationRaw : null,
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
