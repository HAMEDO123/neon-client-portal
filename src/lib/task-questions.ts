// Asking about a task, in a chat.
//
// Somebody handed a job has questions about it, and until now the only place
// to ask was a chat that did not know which job was meant. The studio asked
// for it: from a task, write to the manager privately or to the company's
// group, and carry on the discussion there.
//
// A question is an ordinary chat message. Two things make it one about a task:
//
// - The message's first line names the task — "📋 تنظيف الشركة" — in the text
//   itself, the way a photo's line begins 📷 and a voice note's 🎤. So a lock
//   screen, the chat list, the phone app and anything else that only has the
//   text still says what is being asked about.
// - The message row carries which task it was (`aboutAssignedTaskId` or
//   `aboutEntryId`) and what it was called (`aboutTitle`), so a screen that
//   can draw more draws that line as a quote that opens the task.
//
// Pure: the wording, and taking it apart again.

/** What begins the line that names the task. */
export const TASK_MARK = "📋";

export const QUESTION_MAX = 2000;
const TITLE_MAX = 140;

/** A job handed out by hand, or a cell of the project board. */
export type AboutKind = "assigned" | "board";

export function readAboutKind(value: unknown): AboutKind | null {
  return value === "assigned" || value === "board" ? value : null;
}

/** Where a question goes: the manager, privately, or the company's group. */
export type AskWhere = "manager" | "team";

export function readAskWhere(value: unknown): AskWhere | null {
  return value === "manager" || value === "team" ? value : null;
}

/**
 * A task's name as it is quoted: one line, and not the whole of a long one.
 * It is the first line of a message, so a line break in it would end the
 * quote early and leave the rest reading as the question.
 */
export function quotedTitle(title: string) {
  const line = title.replace(/\s+/g, " ").trim();
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
}

/** The message as it is stored: the task named on the first line, then the question. */
export function questionBody(title: string, text: string) {
  return `${TASK_MARK} ${quotedTitle(title)}\n${text.trim()}`;
}

/**
 * A stored message taken apart for a screen that draws the task as a quote:
 * what to quote, and what was actually said.
 *
 * The first line is only taken off when it is exactly the line this module
 * wrote. A message that merely happens to start with a clipboard is somebody's
 * own words and stays whole.
 */
export function splitQuestion(body: string | null | undefined, aboutTitle: string | null | undefined) {
  const text = body ?? null;
  if (!aboutTitle) return { quoted: null, text };

  const head = `${TASK_MARK} ${aboutTitle}`;
  if (text === head) return { quoted: aboutTitle, text: null };
  if (text?.startsWith(`${head}\n`)) return { quoted: aboutTitle, text: text.slice(head.length + 1) };
  return { quoted: aboutTitle, text };
}

/** The columns a message carries when it asks about a task. */
export type AboutTask = {
  aboutAssignedTaskId: string | null;
  aboutEntryId: string | null;
  aboutTitle: string | null;
};

/**
 * Where a quoted task opens, or null when there is nowhere this reader can go.
 *
 * The manager opens the week the job is on, or the board. Somebody on the team
 * opens the task's own page — but only whoever asked, because a task's page is
 * its owner's alone and in the company's group everybody else sees the quote:
 * a link there would open "not found" for all but one of them.
 */
export function aboutTaskUrl(side: "ADMIN" | "EMPLOYEE", about: AboutTask, mine: boolean): string | null {
  if (side === "ADMIN") {
    if (about.aboutAssignedTaskId) return `/admin/tasks/job/${about.aboutAssignedTaskId}`;
    return about.aboutEntryId ? "/admin/tasks" : null;
  }
  if (!mine) return null;
  if (about.aboutAssignedTaskId) return `/employee/assigned/${about.aboutAssignedTaskId}`;
  return about.aboutEntryId ? `/employee/tasks/${about.aboutEntryId}` : null;
}
