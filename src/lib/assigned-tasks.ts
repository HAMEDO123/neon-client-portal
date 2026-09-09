import { prisma } from "@/lib/db";
import { dateToDayKey, dayKeyToDate } from "@/lib/time";
import { weekDayKeys } from "@/lib/week";

// Work the manager hands out directly, outside any project.
//
// "Go and negotiate with the supplier, two days" has no cell on the board — it
// is a job for a person over a span of days. Stored as two calendar days rather
// than timestamps, because that is how it is decided and how it is read.

export type AssignedTaskView = {
  id: string;
  employeeId: string;
  title: string;
  note: string | null;
  startKey: string;
  endKey: string;
  state: "TODO" | "IN_PROGRESS" | "SUBMITTED" | "DONE" | "TOMORROW";
  priority: "LOW" | "MEDIUM" | "HIGH";
};

function toView(row: {
  id: string;
  employeeId: string;
  title: string;
  note: string | null;
  startDay: Date;
  endDay: Date;
  state: AssignedTaskView["state"];
  priority: AssignedTaskView["priority"];
}): AssignedTaskView {
  return {
    id: row.id,
    employeeId: row.employeeId,
    title: row.title,
    note: row.note,
    startKey: dateToDayKey(row.startDay)!,
    endKey: dateToDayKey(row.endDay)!,
    state: row.state,
    priority: row.priority,
  };
}

const view = {
  id: true,
  employeeId: true,
  title: true,
  note: true,
  startDay: true,
  endDay: true,
  state: true,
  priority: true,
} as const;

/**
 * Every job overlapping the week containing `anchorDayKey`.
 *
 * Overlapping, not starting in: a job that runs from last Thursday into this
 * Tuesday is this week's work too, and the week that shows only what began in
 * it would hide the thing somebody is doing right now.
 */
export async function assignedTasksForWeek(anchorDayKey: string) {
  const keys = weekDayKeys(anchorDayKey);
  const rows = await prisma.assignedTask.findMany({
    where: {
      startDay: { lte: dayKeyToDate(keys[keys.length - 1]) },
      endDay: { gte: dayKeyToDate(keys[0]) },
    },
    orderBy: [{ startDay: "asc" }, { createdAt: "asc" }],
    select: view,
  });

  return rows.map(toView);
}

/** One employee's own jobs, for their portal. */
export async function myAssignedTasks(employeeId: string, options?: { includeDone?: boolean }) {
  const rows = await prisma.assignedTask.findMany({
    where: {
      employeeId,
      ...(options?.includeDone ? {} : { NOT: { state: "DONE" } }),
    },
    orderBy: [{ endDay: "asc" }, { priority: "desc" }],
    select: view,
  });

  return rows.map(toView);
}

/** One job, but only if it belongs to this employee. */
export async function myAssignedTask(employeeId: string, id: string) {
  const row = await prisma.assignedTask.findFirst({ where: { id, employeeId }, select: view });
  return row ? toView(row) : null;
}

export function countMyOpenAssignedTasks(employeeId: string) {
  return prisma.assignedTask.count({ where: { employeeId, NOT: { state: "DONE" } } });
}
