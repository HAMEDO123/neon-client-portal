import { prisma } from "@/lib/db";
import { describeMove, type Actor } from "@/lib/task-transitions";
import type { TaskState } from "@/generated/prisma/enums";

// The record of every state a task has been in, and who put it there.
//
// One function, called from wherever a state is written, so the log cannot
// drift from the truth: if a path does not call it, the gap is in one visible
// place rather than spread across six actions.
//
// Rows are only ever added. A change made in error is corrected by another
// change, and both stay — that is the point of a record.

export type StateChange = {
  /** One of the two, never both. */
  entryId?: string | null;
  assignedTaskId?: string | null;
  from: TaskState;
  to: TaskState;
  actor: Actor;
  /** The employee who did it, where there is one. The manager is one shared account. */
  actorEmployeeId?: string | null;
  /** A review note, or why something was reopened. */
  reason?: string | null;
};

/**
 * Writes one move down.
 *
 * Never throws into the caller: a state change that happened must not be undone
 * because the note about it could not be written. A missing row is a gap in the
 * record; a failed update would be a lie about the work.
 */
export async function recordStateChange(change: StateChange): Promise<void> {
  if (change.from === change.to) return;

  await prisma.taskStateChange
    .create({
      data: {
        entryId: change.entryId ?? null,
        assignedTaskId: change.assignedTaskId ?? null,
        fromState: change.from,
        toState: change.to,
        actorType: change.actor,
        actorEmployeeId: change.actorEmployeeId ?? null,
        reason: change.reason?.trim()?.slice(0, 2000) || null,
        automatic: change.actor === "system",
      },
    })
    .catch(() => null);
}

/** What happened to one task, oldest first, for a timeline on a screen. */
export async function changesFor(input: { entryId?: string; assignedTaskId?: string }, limit = 50) {
  const where = input.entryId ? { entryId: input.entryId } : { assignedTaskId: input.assignedTaskId };

  const rows = await prisma.taskStateChange.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  return rows.map((row) => ({
    ...row,
    /** The move as a person would say it: "sent for review", "approved". */
    said: describeMove(row.fromState, row.toState),
  }));
}

/** When this task was first started, according to the record rather than a column. */
export async function firstStartedAt(entryId: string): Promise<Date | null> {
  const row = await prisma.taskStateChange.findFirst({
    where: { entryId, toState: "IN_PROGRESS" },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });

  return row?.createdAt ?? null;
}
