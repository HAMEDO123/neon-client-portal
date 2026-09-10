import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ownerOf } from "@/lib/ownership";
import { dayKeyToDate } from "@/lib/time";

// One definition of "this employee's tasks", shared by the portal and the
// notification jobs so what an employee is told always matches what they see.
//
// A task belongs to an employee the way the board decides it (ownerOf in
// ownership.ts): a person named on the cell, then whoever holds the step's
// section on that project, then the step's standing owner. The rule lives in
// the SQL `where`, not in application code after the fetch, so there is no
// path that returns another employee's row in the first place.
export async function ownedBy(employeeId: string): Promise<Prisma.ProjectTaskEntryWhereInput> {
  // Who holds which section of which project. A section with nobody on it
  // falls back to the step owners, so only the held ones change anything.
  const held = await prisma.projectSectionAssignment.findMany({
    where: { employeeId: { not: null } },
    select: { projectId: true, sectionId: true, employeeId: true },
  });
  const mine = held.filter((row) => row.employeeId === employeeId);
  const others = held.filter((row) => row.employeeId !== employeeId);

  return {
    OR: [
      // Named on the cell.
      { assigneeId: employeeId },
      // Holds the step's section on this project.
      ...mine.map((row) => ({ assigneeId: null, projectId: row.projectId, task: { sectionId: row.sectionId } })),
      // Owns the step, on every project where nobody else holds its section.
      {
        assigneeId: null,
        task: { employeeId },
        ...(others.length > 0
          ? { NOT: others.map((row) => ({ projectId: row.projectId, task: { sectionId: row.sectionId } })) }
          : {}),
      },
    ],
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
  excludedFromProgress: true,
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
export async function tasksForDay(employeeId: string, dayKey: string, treatFlagAsDay: "tomorrow" | null = null) {
  const scheduled: Prisma.ProjectTaskEntryWhereInput = { scheduledFor: dayKeyToDate(dayKey) };

  // The board's existing "tomorrow" tick is a scheduling statement, so it
  // pulls a task into tomorrow's list even with no explicit date on it.
  const where: Prisma.ProjectTaskEntryWhereInput = {
    AND: [
      await ownedBy(employeeId),
      treatFlagAsDay === "tomorrow"
        ? { OR: [scheduled, { scheduledFor: null, state: "TOMORROW" }] }
        : scheduled,
    ],
  };

  return prisma.projectTaskEntry.findMany({ where, select: taskSelect, orderBy: ORDER });
}

export async function countTasksForDay(
  employeeId: string,
  dayKey: string,
  treatFlagAsDay: "tomorrow" | null = null
) {
  const scheduled: Prisma.ProjectTaskEntryWhereInput = { scheduledFor: dayKeyToDate(dayKey) };
  return prisma.projectTaskEntry.count({
    where: {
      AND: [
        await ownedBy(employeeId),
        treatFlagAsDay === "tomorrow"
          ? { OR: [scheduled, { scheduledFor: null, state: "TOMORROW" }] }
          : scheduled,
      ],
    },
  });
}

/** Everything assigned to this employee, newest work first. */
export async function allTasks(employeeId: string, filter?: "open" | "completed") {
  return prisma.projectTaskEntry.findMany({
    where: {
      AND: [
        await ownedBy(employeeId),
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
    where: { AND: [{ id: entryId }, await ownedBy(employeeId)] },
    select: taskSelect,
  });
}

/**
 * The employee a task should notify: its owner, by the same rule as the list
 * they see it in — named on the cell, then the section holder on this
 * project, then the step's owner.
 */
export async function ownerOfEntry(entry: {
  projectId: string;
  assigneeId: string | null;
  task: { employeeId: string | null; sectionId: string | null };
}) {
  if (entry.assigneeId) return entry.assigneeId;
  const holder = entry.task.sectionId
    ? await prisma.projectSectionAssignment.findUnique({
        where: { projectId_sectionId: { projectId: entry.projectId, sectionId: entry.task.sectionId } },
        select: { employeeId: true },
      })
    : null;
  return ownerOf(null, entry.task, holder?.employeeId);
}
