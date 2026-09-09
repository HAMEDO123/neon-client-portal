import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { dayKeyToDate } from "@/lib/time";

// One definition of "this employee's tasks", shared by the portal and the
// notification jobs so what an employee is told always matches what they see.
//
// A task belongs to an employee when it is assigned to them directly, or when
// it is unassigned and they own the process step it came from. The rule lives
// in the SQL `where`, not in application code after the fetch, so there is no
// path that returns another employee's row in the first place.
export function ownedBy(employeeId: string): Prisma.ProjectTaskEntryWhereInput {
  return {
    OR: [{ assigneeId: employeeId }, { assigneeId: null, task: { employeeId } }],
  };
}

const taskSelect = {
  id: true,
  state: true,
  priority: true,
  scheduledFor: true,
  dueAt: true,
  adminNote: true,
  employeeNote: true,
  completedAt: true,
  startedAt: true,
  createdAt: true,
  updatedAt: true,
  assigneeId: true,
  task: { select: { id: true, name: true, employeeId: true } },
  project: { select: { id: true, name: true, clientName: true, location: true } },
} satisfies Prisma.ProjectTaskEntrySelect;

export type EmployeeTask = Prisma.ProjectTaskEntryGetPayload<{ select: typeof taskSelect }>;

const ORDER: Prisma.ProjectTaskEntryOrderByWithRelationInput[] = [
  { priority: "desc" },
  { dueAt: "asc" },
  { task: { order: "asc" } },
];

/** Tasks for one calendar day. TOMORROW-flagged work counts as tomorrow's. */
export function tasksForDay(employeeId: string, dayKey: string, treatFlagAsDay: "tomorrow" | null = null) {
  const scheduled: Prisma.ProjectTaskEntryWhereInput = { scheduledFor: dayKeyToDate(dayKey) };

  // The board's existing "tomorrow" tick is a scheduling statement, so it
  // pulls a task into tomorrow's list even with no explicit date on it.
  const where: Prisma.ProjectTaskEntryWhereInput = {
    AND: [
      ownedBy(employeeId),
      treatFlagAsDay === "tomorrow"
        ? { OR: [scheduled, { scheduledFor: null, state: "TOMORROW" }] }
        : scheduled,
    ],
  };

  return prisma.projectTaskEntry.findMany({ where, select: taskSelect, orderBy: ORDER });
}

export function countTasksForDay(employeeId: string, dayKey: string, treatFlagAsDay: "tomorrow" | null = null) {
  const scheduled: Prisma.ProjectTaskEntryWhereInput = { scheduledFor: dayKeyToDate(dayKey) };
  return prisma.projectTaskEntry.count({
    where: {
      AND: [
        ownedBy(employeeId),
        treatFlagAsDay === "tomorrow"
          ? { OR: [scheduled, { scheduledFor: null, state: "TOMORROW" }] }
          : scheduled,
      ],
    },
  });
}

/** Everything assigned to this employee, newest work first. */
export function allTasks(employeeId: string, filter?: "open" | "completed") {
  return prisma.projectTaskEntry.findMany({
    where: {
      AND: [
        ownedBy(employeeId),
        filter === "completed" ? { state: "DONE" } : filter === "open" ? { NOT: { state: "DONE" } } : {},
      ],
    },
    select: taskSelect,
    orderBy: ORDER,
  });
}

/**
 * One task, but only if it belongs to this employee. Returns null otherwise —
 * an employee guessing another employee's task id gets a 404, not a record.
 */
export async function taskForEmployee(employeeId: string, entryId: string) {
  return prisma.projectTaskEntry.findFirst({
    where: { AND: [{ id: entryId }, ownedBy(employeeId)] },
    select: taskSelect,
  });
}

/** The employee a task should notify: the explicit assignee, else the step's owner. */
export function assigneeOf(entry: { assigneeId: string | null; task: { employeeId: string | null } }) {
  return entry.assigneeId ?? entry.task.employeeId ?? null;
}
