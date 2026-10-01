import { prisma } from "@/lib/db";
import { ownedBy } from "@/lib/employee-tasks";
import { myDay } from "@/lib/now-next-queries";
import { onlineNow } from "@/lib/presence-store";
import type { NowNext, PlanSlot } from "@/lib/now-next";

// The manager's Home tab, "Right now": for each active employee, what they
// are on and what is next — reusing the same facts the employee's own screen
// and the day board already read, never re-derived.
//
// Two different kinds of "on it right now" are shown side by side, because
// they answer different questions: the *plan* (myDay, lib/now-next-queries.ts
// — the block from their published day) says what the manager scheduled;
// *IN_PROGRESS* work (a board cell or a hand-assigned job) says what the
// employee actually started, which can run ahead of, behind, or entirely
// outside a plan. Ownership of a board cell is never re-derived here —
// `ownedBy` (lib/employee-tasks.ts) is the one rule, same as everywhere else.
//
// A person with neither is not idle — the platform cannot tell "nothing to
// do" from "hasn't started" from "no plan was made" — so this returns null/[]
// and leaves the exact neutral wording ("Nothing planned right now") to the
// app, the same refusal the day board and now-next make everywhere else.

type Slot = { what: string; from: string; to: string; leftMinutes: number | null; entryId: string | null; jobId: string | null };

function slot(block: PlanSlot | null, leftMinutes: number | null): Slot | null {
  if (!block) return null;
  return { what: block.what, from: block.from, to: block.to, leftMinutes, entryId: block.entryId, jobId: block.jobId };
}

function minutesSince(start: Date | null, now: number): number | null {
  if (!start) return null;
  return Math.max(0, Math.round((now - start.getTime()) / 60_000));
}

/** One employee's "in progress" work: board cells and hand-assigned jobs, both by `state: IN_PROGRESS`. */
async function inProgressFor(employeeId: string, now: number) {
  const entries = await prisma.projectTaskEntry.findMany({
    where: { AND: [await ownedBy(employeeId), { state: "IN_PROGRESS" }] },
    select: {
      id: true,
      startedAt: true,
      task: { select: { name: true } },
      project: { select: { name: true } },
    },
  });

  const jobs = await prisma.assignedTask.findMany({
    where: { employeeId, state: "IN_PROGRESS" },
    select: { id: true, title: true },
  });

  // A job handed out by hand has no `startedAt` column of its own (see
  // AssignedTask in prisma/schema.prisma) — its start, where recorded, is the
  // first time it was moved to IN_PROGRESS. lib/task-state-log.ts writes that
  // move for both a board cell and a job (my-assigned-actions.ts,
  // assigned-task-actions.ts both call recordStateChange); this reads the
  // same table rather than adding a second record of the same fact.
  const jobStarts =
    jobs.length > 0
      ? await prisma.taskStateChange.findMany({
          where: { assignedTaskId: { in: jobs.map((job) => job.id) }, toState: "IN_PROGRESS" },
          orderBy: { createdAt: "asc" },
          select: { assignedTaskId: true, createdAt: true },
        })
      : [];
  const firstJobStart = new Map<string, Date>();
  for (const row of jobStarts) {
    if (row.assignedTaskId && !firstJobStart.has(row.assignedTaskId)) {
      firstJobStart.set(row.assignedTaskId, row.createdAt);
    }
  }

  return [
    ...entries.map((entry) => ({
      kind: "cell" as const,
      id: entry.id,
      title: entry.task.name,
      projectName: entry.project.name as string | null,
      startedAt: entry.startedAt,
      minutes: minutesSince(entry.startedAt, now),
    })),
    ...jobs.map((job) => {
      const startedAt = firstJobStart.get(job.id) ?? null;
      return {
        kind: "job" as const,
        id: job.id,
        title: job.title,
        projectName: null as string | null,
        startedAt,
        minutes: minutesSince(startedAt, now),
      };
    }),
  ];
}

/** The dashboard's "Right now" strip: one row per active employee. */
export async function homeNow() {
  const employees = await prisma.employee.findMany({
    where: { active: true, accessRole: "EMPLOYEE" },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    // No avatar image exists anywhere on Employee — every screen in this
    // codebase draws people from their initials and colour instead.
    select: { id: true, name: true, color: true, photoUrl: true },
  });

  const onlineKeys = new Set((await onlineNow()).map((row) => row.memberKey));
  const now = Date.now();

  const people = [];
  // One person after another, like dayBoard() just above this in the admin
  // dashboard's own read: several of these queries fired for everybody at
  // once is what drops the local database's connection (see README).
  for (const employee of employees) {
    const { state }: { state: NowNext } = await myDay(employee.id);
    const inProgress = await inProgressFor(employee.id, now);

    people.push({
      id: employee.id,
      name: employee.name,
      color: employee.color,
      photo: employee.photoUrl,
      avatar: null as string | null,
      online: onlineKeys.has(employee.id),
      now: slot(state.now, state.leftOfBlock),
      next: slot(state.next, null),
      inProgress,
      afterWork: state.afterWork,
      beforeWork: state.beforeWork,
    });
  }

  return { people };
}
