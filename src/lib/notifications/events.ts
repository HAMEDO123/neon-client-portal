import { prisma } from "@/lib/db";
import { dispatchNotification, getPreferences } from "@/lib/notifications/engine";
import {
  assignedCopy,
  assignedKey,
  changedFields,
  deadlineCopy,
  deadlineKey,
  describeChanges,
  revisionStamp,
  scheduleCopy,
  scheduleKey,
  scheduleUrl,
  taskUrl,
  updatedCopy,
  updatedKey,
  type TaskSnapshot,
} from "@/lib/notifications/types";
import { assigneeOf, countTasksForDay } from "@/lib/employee-tasks";
import { getTimezone } from "@/lib/settings";
import { dayKeyToDate, formatTimeIn, todayKey, tomorrowKey } from "@/lib/time";

// The events that produce notifications. Admin code calls these; it never
// builds a notification itself and never has to think about push, devices or
// preferences.

const entryInclude = {
  task: { select: { id: true, name: true, employeeId: true } },
  project: { select: { name: true } },
} as const;

export function snapshotOf(entry: {
  task: { name: string };
  adminNote: string | null;
  priority: TaskSnapshot["priority"];
  dueAt: Date | null;
  scheduledFor: Date | null;
  assigneeId: string | null;
}): TaskSnapshot {
  return {
    name: entry.task.name,
    adminNote: entry.adminNote,
    priority: entry.priority,
    dueAt: entry.dueAt,
    scheduledFor: entry.scheduledFor,
    assigneeId: entry.assigneeId,
  };
}

/** Admin gave a task to an employee. Only that employee hears about it. */
export async function notifyTaskAssigned(entryId: string, employeeId?: string | null) {
  const entry = await prisma.projectTaskEntry.findUnique({ where: { id: entryId }, include: entryInclude });
  if (!entry) return { created: false as const, skipped: "missing-task" as const };

  const recipient = employeeId ?? assigneeOf(entry);
  if (!recipient) return { created: false as const, skipped: "unassigned" as const };

  const copy = assignedCopy(entry.task.name, entry.project.name);
  return dispatchNotification({
    employeeId: recipient,
    type: "TASK_ASSIGNED",
    title: copy.title,
    message: copy.message,
    url: taskUrl(entry.id),
    entryId: entry.id,
    dedupeKey: assignedKey(entry.id, recipient),
    metadata: { project: entry.project.name, task: entry.task.name },
  });
}

/**
 * Admin edited a task. Only meaningful changes notify, and re-saving the same
 * values notifies nobody — the dedupe key is derived from what changed.
 */
export async function notifyTaskUpdated(entryId: string, before: TaskSnapshot, after: TaskSnapshot) {
  const fields = changedFields(before, after);
  if (fields.length === 0) return { created: false as const, skipped: "no-meaningful-change" as const };

  const entry = await prisma.projectTaskEntry.findUnique({ where: { id: entryId }, include: entryInclude });
  if (!entry) return { created: false as const, skipped: "missing-task" as const };

  const recipient = assigneeOf(entry);
  if (!recipient) return { created: false as const, skipped: "unassigned" as const };

  // Reassignment is an assignment for the new owner, not an "updated" notice.
  if (fields.includes("assigneeId") && before.assigneeId !== recipient) {
    return notifyTaskAssigned(entry.id, recipient);
  }

  const copy = updatedCopy(entry.task.name, describeChanges(fields));
  return dispatchNotification({
    employeeId: recipient,
    type: "TASK_UPDATED",
    title: copy.title,
    message: copy.message,
    url: taskUrl(entry.id),
    entryId: entry.id,
    dedupeKey: updatedKey(entry.id, recipient, revisionStamp(fields, after)),
    metadata: { changed: fields },
  });
}

/**
 * The daily summary: one notification per employee, never one per task.
 * Idempotent on employee + type + day, so a job that fires twice writes once.
 */
export async function runScheduleNotifier(day: "today" | "tomorrow", now = new Date()) {
  const timezone = await getTimezone();
  const dayKey = day === "tomorrow" ? tomorrowKey(timezone) : todayKey(timezone);

  const employees = await prisma.employee.findMany({
    where: { active: true, accessRole: "EMPLOYEE" },
    select: { id: true, name: true },
  });

  const results: { employeeId: string; count: number; created: boolean; skipped?: string }[] = [];

  for (const employee of employees) {
    const count = await countTasksForDay(employee.id, dayKey, day === "tomorrow" ? "tomorrow" : null);
    if (count === 0) continue;

    const copy = scheduleCopy(day, count);
    const outcome = await dispatchNotification({
      employeeId: employee.id,
      type: day === "tomorrow" ? "TASK_TOMORROW_SCHEDULE" : "TASK_TODAY_SCHEDULE",
      title: copy.title,
      message: copy.message,
      url: scheduleUrl(day),
      dedupeKey: scheduleKey(
        day === "tomorrow" ? "TASK_TOMORROW_SCHEDULE" : "TASK_TODAY_SCHEDULE",
        employee.id,
        dayKey
      ),
      metadata: { day: dayKey, count },
    });

    results.push({ employeeId: employee.id, count, created: outcome.created, skipped: outcome.skipped });
  }

  return { day, dayKey, timezone, ranAt: now.toISOString(), employees: results };
}

/**
 * Deadline reminders. The lead time is per employee and configurable, so
 * nothing here assumes a particular hour.
 */
export async function runDeadlineReminders(now = new Date()) {
  const timezone = await getTimezone();

  const candidates = await prisma.projectTaskEntry.findMany({
    where: {
      dueAt: { not: null, gte: now },
      NOT: { state: "DONE" },
    },
    include: entryInclude,
  });

  const results: { entryId: string; created: boolean; skipped?: string }[] = [];

  for (const entry of candidates) {
    const recipient = assigneeOf(entry);
    if (!recipient || !entry.dueAt) continue;

    const preferences = await getPreferences(recipient);
    const minutesAway = (entry.dueAt.getTime() - now.getTime()) / 60000;
    if (minutesAway > preferences.deadlineLeadMinutes) continue;

    const copy = deadlineCopy(entry.task.name, formatTimeIn(timezone, entry.dueAt));
    const outcome = await dispatchNotification({
      employeeId: recipient,
      type: "TASK_DEADLINE_REMINDER",
      title: copy.title,
      message: copy.message,
      url: taskUrl(entry.id),
      entryId: entry.id,
      // Keyed on the deadline itself: one reminder per deadline, and moving
      // the deadline earns a new one.
      dedupeKey: deadlineKey(entry.id, recipient, entry.dueAt),
      metadata: { dueAt: entry.dueAt.toISOString() },
    });

    results.push({ entryId: entry.id, created: outcome.created, skipped: outcome.skipped });
  }

  return { timezone, ranAt: now.toISOString(), reminders: results };
}

/** Used by the admin UI to schedule a task onto a specific day. */
export function scheduleDate(dayKey: string | null) {
  return dayKey ? dayKeyToDate(dayKey) : null;
}
