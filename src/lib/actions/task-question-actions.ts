"use server";

import { revalidatePath } from "next/cache";
import { notifyAdmin } from "@/lib/admin-notifications";
import { channelFor, type ChatViewer, type Conversation } from "@/lib/chat";
import { adminChatUrl } from "@/lib/chat-conversations";
import { postChatMessage } from "@/lib/chat-send";
import { requireEmployee } from "@/lib/employee-session";
import { Refusal, answering, type Answer } from "@/lib/refusal";
import { taskAskedAbout } from "@/lib/task-question-store";
import { QUESTION_MAX, questionBody, readAboutKind, readAskWhere } from "@/lib/task-questions";

// Asking about a task from the task's own page: a question to the manager,
// privately, or to the company's group, with the task's name on it. See
// lib/task-questions.ts for why it is an ordinary chat message.
//
// The form names the task and where the question goes and nothing else. Who is
// asking comes from the session, and the task is only ever found as theirs.

function clip(text: string, max = 140) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Form: `kind` ("assigned" | "board"), `id`, `where` ("manager" | "team") and
 * `body`. Answers in words rather than throwing them — a thrown sentence does
 * not reach a production page (lib/refusal.ts).
 */
export async function askAboutTask(formData: FormData): Promise<Answer> {
  return answering(async () => {
    const employee = await requireEmployee();

    const kind = readAboutKind(formData.get("kind"));
    const where = readAskWhere(formData.get("where"));
    const id = String(formData.get("id") ?? "");
    const text = String(formData.get("body") ?? "").trim().slice(0, QUESTION_MAX);

    if (!kind || !id) throw new Refusal("That task could not be found.");
    if (!where) throw new Refusal("Choose who to ask: the manager, or the team's group.");
    if (!text) throw new Refusal("Write your question first.");

    const about = await taskAskedAbout(employee.id, kind, id);
    if (!about?.aboutTitle) throw new Refusal("That task is not on your list any more.");

    // The same two conversations the chat itself opens for this person, through
    // the same check: their own private chat with the manager, or the team's.
    const viewer: ChatViewer = { type: "EMPLOYEE", id: employee.id, name: employee.name };
    const conversation: Conversation =
      where === "team" ? { kind: "team" } : { kind: "direct", employeeId: employee.id };
    const channel = await channelFor(viewer, conversation);
    if (!channel) throw new Refusal("That conversation could not be opened.");

    const message = await postChatMessage(viewer, conversation, channel.id, {
      kind: "TEXT",
      body: questionBody(about.aboutTitle, text),
      ...about,
      // The team's group is not pushed to the manager — it would put the whole
      // studio's chatter on their phone. A question about a job they handed
      // out is the exception: it is addressed to them wherever it was asked.
      alsoManager: where === "team",
    });

    // And in the manager's own feed, so a question is not only a line in a
    // chat that has moved on by the time they look.
    void notifyAdmin({
      type: "CHAT_MESSAGE",
      title: `${employee.name} asked about a task`,
      message: clip(`${about.aboutTitle} — ${text}`),
      url: adminChatUrl(conversation),
      dedupeKey: `TASK_QUESTION:${message.id}`,
      employeeId: employee.id,
      entryId: about.aboutEntryId ?? undefined,
    });

    // The task's page lists what was asked about it.
    revalidatePath("/employee", "layout");
  });
}
