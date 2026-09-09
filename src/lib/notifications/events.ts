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
  stageReminderCopy,
  stageReminderKey,
  taskUrl,
  updatedCopy,
  updatedKey,
  type TaskSnapshot,
} from "@/lib/notifications/types";
import { assigneeOf, countTasksForDay } from "@/lib/employee-tasks";
import { planForProjects } from "@/lib/stage-deadlines";
import { countdownOf } from "@/lib/stage-schedule";
import { notifyAdmin } from "@/lib/admin-notifications";
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

/**
 * The daily chase against the stage periods.
 *
 * Each step of the process has a length, so every open cell has a deadline
 * whether or not anyone typed one. This looks at all of them once a day and
 * says something when a task is within a couple of days of its deadline, and
 * again every day it stays late — that is the "your period is getting shorter"
 * the board is supposed to enforce.
 *
 * The manager hears about the late ones too: an overdue stage holds up every
 * stage behind it, which is their problem rather than the employee's alone.
 *
 * Idempotent per task per day, so an extra run says nothing new.
 */
export async function runStageReminders(now = new Date()) {
  const timezone = await getTimezone();
  const day = todayKey(timezone);

  const projects = await prisma.project.findMany({
    where: { publishState: { not: "ARCHIVED" } },
    select: { id: true },
  });
  if (projects.length === 0) return { timezone, ranAt: now.toISOString(), reminders: [] };

  const plan = await planForProjects(projects.map((project) => project.id));

  const entries = await prisma.projectTaskEntry.findMany({
    where: {
      projectId: { in: projects.map((project) => project.id) },
      state: { notIn: ["DONE", "SUBMITTED"] },
      // A step nobody is counting is a step nobody is chased about.
      excludedFromProgress: false,
    },
    include: entryInclude,
  });

  const reminders: { entryId: string; days: number; created: boolean; skipped?: string }[] = [];

  for (const entry of entries) {
    const stage = plan.get(entry.id);
    if (!stage?.dueBy) continue;

    const recipient = assigneeOf(entry);
    if (!recipient) continue;

    const countdown = countdownOf(stage.dueBy, now);

    // Nothing to say while there is still room.
    if (countdown.days > 2) continue;

    // A hand-typed deadline that has not passed belongs to the lead-time
    // reminders above; chasing it here as well would say it twice.
    if (stage.source === "explicit" && !countdown.overdue) continue;

    const copy = stageReminderCopy(entry.task.name, entry.project.name, countdown);
    const outcome = await dispatchNotification({
      employeeId: recipient,
      // Being late is a company matter rather than a convenience, so it is not
      // something a preference can silence. A deadline merely approaching is.
      type: countdown.overdue ? "SYSTEM_NOTIFICATION" : "TASK_DEADLINE_REMINDER",
      title: copy.title,
      message: copy.message,
      url: taskUrl(entry.id),
      entryId: entry.id,
      dedupeKey: stageReminderKey(entry.id, recipient, day),
      metadata: { dueBy: stage.dueBy.toISOString(), days: countdown.days, source: stage.source },
    });

    if (countdown.overdue) {
      await notifyAdmin({
        type: "TASK_OVERDUE",
        title: `Overdue: ${entry.task.name}`,
        message: `${entry.project.name} — ${countdown.label.toLowerCase()}. Everything after this stage is waiting on it.`,
        url: "/admin/tasks",
        dedupeKey: `TASK_OVERDUE:${entry.id}:${day}`,
        entryId: entry.id,
        employeeId: recipient,
      });
    }

    reminders.push({
      entryId: entry.id,
      days: countdown.days,
      created: outcome.created,
      skipped: outcome.skipped,
    });
  }

  return { timezone, day, ranAt: now.toISOString(), reminders };
}

/** Used by the admin UI to schedule a task onto a specific day. */
export function scheduleDate(dayKey: string | null) {
  return dayKey ? dayKeyToDate(dayKey) : null;
}
