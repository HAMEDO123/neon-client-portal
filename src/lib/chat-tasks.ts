import type { TaskPriority, TaskState } from "@/generated/prisma/enums";
import type { ChatViewer, Conversation } from "@/lib/chat-conversations";
import { dayKeyIn, instantAt } from "@/lib/time";
import { daysBetween } from "@/lib/week";
import { isWorkingDay, minutesOf, nextWorkingDay, type WorkHours } from "@/lib/work-hours";

// Tasks the manager hands out from a chat, shown there as cards.
//
// Pure, and the one place their rules are written: what "/task" means, when a
// task is due if nobody says, who it may be given to, how a card with several
// people on it reads as a whole, and when it is late. The database side is
// chat-task-store.ts; the card is components/chat/task-card.tsx.
//
// A card is not a new kind of work. Each person on it has an ordinary
// AssignedTask, so where their part stands, and who may move it, are the rules
// in task-transitions.ts — nothing here decides a state.

export const TASK_TITLE_MAX = 200;
export const TASK_DESCRIPTION_MAX = 4000;
export const TASK_COMMENT_MAX = 2000;

export const TASK_PRIORITIES: TaskPriority[] = ["LOW", "MEDIUM", "HIGH"];

/** The words on a card for where one person's part stands. */
export const CARD_STATE_LABEL: Record<TaskState, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Sent for review",
  DONE: "Done",
  // Nothing on a card sets it; a job moved to tomorrow on the board is still to do.
  TOMORROW: "To do",
};

/**
 * What "/task …" typed into the message box means: the task form, with the
 * rest of the line as its title. Null for an ordinary message — "/tasks" and
 * "/taskforce" included.
 */
export function slashTask(text: string): { title: string } | null {
  const match = /^\/task(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return null;
  return { title: (match[1] ?? "").trim().slice(0, TASK_TITLE_MAX) };
}

/**
 * Only the manager hands out tasks, and only where they are in the
 * conversation: the team's group and their private chats. A chat between two
 * employees has no manager in it to hand anything out.
 */
export function mayCreateTasks(viewer: ChatViewer, conversation: Conversation) {
  return viewer.type === "ADMIN" && conversation.kind !== "peer";
}

/** Who may write under a card: the manager, and the people the task was given to. */
export function mayComment(viewer: ChatViewer, assigneeIds: string[]) {
  return viewer.type === "ADMIN" || assigneeIds.includes(viewer.id);
}

export type AssigneeCheck = { ok: true; ids: string[] } | { ok: false; reason: string };

/**
 * The people a task goes to: everyone asked for, each once, as long as every
 * one of them is in the conversation. A list with somebody outside it is
 * refused whole rather than quietly trimmed — handing out less than was asked
 * for is a surprise nobody sees until the work is missing.
 */
export function readAssignees(requested: string[], members: string[]): AssigneeCheck {
  const ids = [...new Set(requested.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return { ok: false, reason: "Choose who it is for." };

  const inChat = new Set(members);
  if (!ids.every((id) => inChat.has(id))) {
    return { ok: false, reason: "A task can only go to people in this chat." };
  }
  return { ok: true, ids };
}

export type DueCheck = { ok: true; dueAt: Date; dayKey: string } | { ok: false; reason: string };

/** The moment the form names, in the company's timezone, or why it is not one. */
export function readDue(dayKey: string, time: string, timeZone: string, now: Date): DueCheck {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return { ok: false, reason: "Pick the day it is due." };
  if (minutesOf(time) == null) return { ok: false, reason: "Pick the time it is due." };

  const dueAt = instantAt(dayKey, time, timeZone);
  // A day that rolls over into the next month ("30 February") is not a day.
  if (!dueAt || dayKeyIn(timeZone, dueAt) !== dayKey) return { ok: false, reason: "That is not a real date." };

  // A minute's grace, for a form filled in a moment ago.
  if (dueAt.getTime() < now.getTime() - 60_000) return { ok: false, reason: "That time has already passed." };

  return { ok: true, dueAt, dayKey };
}

/**
 * When a new task is due unless the manager says otherwise: the end of today's
 * working day while at least an hour of it is left, and the end of the next
 * working day after that.
 */
export function defaultDue(hours: WorkHours, timeZone: string, now: Date): { dayKey: string; time: string } {
  const today = dayKeyIn(timeZone, now);
  const endToday = instantAt(today, hours.end, timeZone);

  if (isWorkingDay(hours, today) && endToday && endToday.getTime() - now.getTime() >= 60 * 60_000) {
    return { dayKey: today, time: hours.end };
  }
  return { dayKey: nextWorkingDay(hours, today), time: hours.end };
}

type Part = { state: TaskState };

/** How many of the people on a card have had their part approved. */
export function progressOf(parts: Part[]) {
  const done = parts.filter((part) => part.state === "DONE").length;
  return { done, total: parts.length, complete: parts.length > 0 && done === parts.length };
}

/**
 * Where a card stands as a whole. Done when everybody's part is approved; sent
 * for review when nothing is left but the manager's look; in progress as soon
 * as anybody has started; to do before that.
 */
export function overallState(parts: Part[]): TaskState {
  if (parts.length === 0) return "TODO";
  if (parts.every((part) => part.state === "DONE")) return "DONE";
  if (parts.every((part) => part.state === "DONE" || part.state === "SUBMITTED")) return "SUBMITTED";
  if (parts.some((part) => part.state !== "TODO" && part.state !== "TOMORROW")) return "IN_PROGRESS";
  return "TODO";
}

/** Late: past the moment it was due, with somebody's part not yet approved. */
export function isOverdue(dueAt: Date | string, parts: Part[], now: number) {
  return new Date(dueAt).getTime() < now && !progressOf(parts).complete;
}

/** How far off the due moment is: "in 45 min", "in 3 h", "in 2 days", "2 h late". */
export function dueDistance(dueAt: Date | string, now: number): { text: string; late: boolean } {
  const diff = new Date(dueAt).getTime() - now;
  const late = diff < 0;
  const minutes = Math.floor(Math.abs(diff) / 60_000);

  if (minutes < 1) return { text: "now", late };

  const span =
    minutes < 60
      ? `${minutes} min`
      : minutes < 48 * 60
        ? `${Math.floor(minutes / 60)} h`
        : `${Math.floor(minutes / (24 * 60))} days`;

  return { text: late ? `${span} late` : `in ${span}`, late };
}

/**
 * The due moment as a card writes it: "Today, 7:00 PM", "Tomorrow, 11:00 AM",
 * "Yesterday, 3:00 PM", then "Thu 17 Sep, 7:00 PM". Days are the company's.
 */
export function dueLabel(dueAt: Date | string, now: Date | number, timeZone: string) {
  const due = new Date(dueAt);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(due);
  const gap = daysBetween(dayKeyIn(timeZone, new Date(now)), dayKeyIn(timeZone, due));

  if (gap === 0) return `Today, ${time}`;
  if (gap === 1) return `Tomorrow, ${time}`;
  if (gap === -1) return `Yesterday, ${time}`;

  // Assembled from parts: en-GB's short September is "Sept" in newer ICU, and
  // en-US on its own puts the month before the day.
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", day: "numeric", month: "short" }).formatToParts(due);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}, ${time}`;
}

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "avif"];

/**
 * Whether an attachment is a picture to show rather than a file to open.
 * Uploads record their extension ("jpg"), which is what saveFile returns; a
 * full media type ("image/png") is read the same way.
 */
export function isImageAttachment(type: string | null | undefined) {
  const value = (type ?? "").trim().toLowerCase();
  return value.startsWith("image/") || IMAGE_EXTENSIONS.includes(value);
}

/**
 * The Tasks list: what is still open first, the soonest due on top — so the
 * late ones lead — and then what is finished, the most recent first.
 */
export function sortTaskList<T extends { dueAt: Date | string; assignments: Part[] }>(items: T[]): T[] {
  const due = (item: T) => new Date(item.dueAt).getTime();
  const open = items.filter((item) => !progressOf(item.assignments).complete).sort((a, b) => due(a) - due(b));
  const finished = items.filter((item) => progressOf(item.assignments).complete).sort((a, b) => due(b) - due(a));
  return [...open, ...finished];
}
