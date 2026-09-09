import type { NotificationType, TaskPriority } from "@/generated/prisma/enums";

// Pure notification rules: which preference gates which type, what a
// notification says, where a click lands, and the idempotency key for each
// logical event. No database and no network, so this is the part the tests
// can pin down exactly.

export type PreferenceFlags = {
  pushEnabled: boolean;
  chatMessages: boolean;
  taskAssigned: boolean;
  taskUpdated: boolean;
  todaySchedule: boolean;
  tomorrowSchedule: boolean;
  deadlineReminders: boolean;
  deadlineLeadMinutes: number;
};

export const DEFAULT_PREFERENCES: PreferenceFlags = {
  pushEnabled: true,
  chatMessages: true,
  taskAssigned: true,
  taskUpdated: true,
  todaySchedule: true,
  tomorrowSchedule: true,
  deadlineReminders: true,
  deadlineLeadMinutes: 120,
};

// SYSTEM_NOTIFICATION has no switch: it is how the platform reaches an
// employee about the account itself, so it is never silenced by preferences.
const PREFERENCE_BY_TYPE: Record<NotificationType, keyof PreferenceFlags | null> = {
  TASK_ASSIGNED: "taskAssigned",
  TASK_UPDATED: "taskUpdated",
  TASK_TODAY_SCHEDULE: "todaySchedule",
  TASK_TOMORROW_SCHEDULE: "tomorrowSchedule",
  TASK_DEADLINE_REMINDER: "deadlineReminders",
  CHAT_MESSAGE: "chatMessages",
  SYSTEM_NOTIFICATION: null,
};

export function isTypeEnabled(type: NotificationType, preferences: PreferenceFlags): boolean {
  const flag = PREFERENCE_BY_TYPE[type];
  if (!flag) return true;
  return Boolean(preferences[flag]);
}

export function isPushEnabled(type: NotificationType, preferences: PreferenceFlags): boolean {
  return preferences.pushEnabled && isTypeEnabled(type, preferences);
}

// --- Where a notification click lands --------------------------------------

export const CHAT_PATH = "/employee/chat";
export const TASK_PATH = "/employee/tasks";
export const DASHBOARD_PATH = "/employee";

export function taskUrl(entryId: string) {
  return `${TASK_PATH}/${entryId}`;
}

export function scheduleUrl(day: "today" | "tomorrow") {
  return day === "tomorrow" ? `${DASHBOARD_PATH}?day=tomorrow` : DASHBOARD_PATH;
}

// --- Idempotency -----------------------------------------------------------
// Every key is derived from the event, never from the clock, so a job that
// runs twice — or a retried request — produces the same key and the second
// write is rejected by the unique index.

export function assignedKey(entryId: string, employeeId: string) {
  return `TASK_ASSIGNED:${entryId}:${employeeId}`;
}

/**
 * Updates must be able to notify more than once, but the *same* update must
 * not. The revision stamp is the set of fields that actually changed plus the
 * values they changed to, so re-running the same save is silent while a
 * genuine second edit is not.
 */
export function updatedKey(entryId: string, employeeId: string, revision: string) {
  return `TASK_UPDATED:${entryId}:${employeeId}:${revision}`;
}

export function scheduleKey(type: NotificationType, employeeId: string, dayKey: string) {
  return `${type}:${employeeId}:${dayKey}`;
}

export function deadlineKey(entryId: string, employeeId: string, dueAt: Date) {
  return `TASK_DEADLINE_REMINDER:${entryId}:${employeeId}:${dueAt.toISOString()}`;
}

// --- Change detection ------------------------------------------------------
// Only fields an employee would care about count as a change. Touching a row
// for a technical reason — a state tick, a counter — must never notify.

export type TaskSnapshot = {
  name: string;
  adminNote: string | null;
  priority: TaskPriority;
  dueAt: Date | null;
  scheduledFor: Date | null;
  assigneeId: string | null;
};

const FIELD_LABELS: Record<keyof TaskSnapshot, string> = {
  name: "Title",
  adminNote: "Description",
  priority: "Priority",
  dueAt: "Deadline",
  scheduledFor: "Date",
  assigneeId: "Assignment",
};

function sameValue(a: unknown, b: unknown) {
  if (a instanceof Date || b instanceof Date) {
    const left = a instanceof Date ? a.getTime() : null;
    const right = b instanceof Date ? b.getTime() : null;
    return left === right;
  }
  return (a ?? null) === (b ?? null);
}

/** The meaningful fields that differ between two versions of a task. */
export function changedFields(before: TaskSnapshot, after: TaskSnapshot): (keyof TaskSnapshot)[] {
  return (Object.keys(FIELD_LABELS) as (keyof TaskSnapshot)[]).filter(
    (field) => !sameValue(before[field], after[field])
  );
}

export function describeChanges(fields: (keyof TaskSnapshot)[]) {
  return fields.map((field) => FIELD_LABELS[field]);
}

/** A stable stamp for one particular edit, used in the dedupe key. */
export function revisionStamp(fields: (keyof TaskSnapshot)[], after: TaskSnapshot) {
  return fields
    .map((field) => {
      const value = after[field];
      const rendered = value instanceof Date ? value.toISOString() : String(value ?? "");
      return `${field}=${rendered}`;
    })
    .join("|");
}

// --- Copy ------------------------------------------------------------------

export function assignedCopy(taskName: string, projectName: string) {
  return {
    title: "New Task Assigned",
    message: `You have a new task assigned to you: ${taskName} (${projectName}).`,
  };
}

export function updatedCopy(taskName: string, changes: string[]) {
  const detail = changes.length ? ` ${changes.join(", ")} changed.` : "";
  return {
    title: "Task Updated",
    message: `"${taskName}" has been updated.${detail}`,
  };
}

export function scheduleCopy(day: "today" | "tomorrow", count: number) {
  const plural = count === 1 ? "task" : "tasks";
  return {
    title: day === "tomorrow" ? "Tomorrow's Schedule" : "Today's Schedule",
    message: `You have ${count} ${plural} scheduled for ${day}.`,
  };
}

export function deadlineCopy(taskName: string, at: string | null) {
  return {
    title: "Task Deadline Approaching",
    message: at ? `"${taskName}" is due at ${at}.` : `"${taskName}" is due soon.`,
  };
}

// --- Push payload ----------------------------------------------------------

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
  notificationId: string;
};

export function pushPayload(input: {
  title: string;
  message: string;
  url: string;
  type: NotificationType;
  notificationId: string;
}): PushPayload {
  return {
    title: input.title,
    body: input.message,
    url: input.url,
    // Same tag collapses an older notification of the same kind on the device
    // rather than stacking duplicates.
    tag: `${input.type}:${input.notificationId}`,
    notificationId: input.notificationId,
  };
}

// --- chat ------------------------------------------------------------------

export function chatKey(messageId: string, employeeId: string) {
  return `CHAT_MESSAGE:${messageId}:${employeeId}`;
}

export function chatCopy(author: string, preview: string) {
  return {
    title: author,
    // The message itself, so the notification is worth reading on a lock
    // screen rather than only telling you to go and look.
    message: preview.length > 140 ? `${preview.slice(0, 137)}…` : preview,
  };
}
