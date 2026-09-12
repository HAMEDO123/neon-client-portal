import { prisma } from "@/lib/db";
import { dayKeyToDate } from "@/lib/time";
import type { PlannedBlock } from "@/lib/day-plan";

// Where a proposed day is kept between generating it and acting on it.
//
// A proposal that lives in a screen's memory is gone the moment the manager
// looks at the board — which is exactly what they do before deciding. So it is
// written down, one per person per day, and every edit rewrites it.
//
// Blocks are stored as JSON because a block is only read and written whole,
// and its shape belongs to lib/day-plan.ts. What comes back out of the column
// is untrusted: a row written by an older version must leave the page working,
// so it is read defensively and anything malformed is dropped rather than
// crashing the page that renders it.

export type StoredDayPlan = {
  blocks: PlannedBlock[];
  /** Anything the model said that was not a block. */
  notes: string[];
  /** When this plan was put on the board, if it has been. */
  appliedAt: Date | null;
  updatedAt: Date;
};

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** One stored block, or null if it is not one. */
function readBlock(value: unknown): PlannedBlock | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;

  const from = asString(row.from);
  const to = asString(row.to);
  const what = asString(row.what);
  if (!from || !to || what == null) return null;

  return {
    from,
    to,
    ref: asString(row.ref),
    what,
    why: asString(row.why),
    entryId: asString(row.entryId),
    taskName: asString(row.taskName),
    projectName: asString(row.projectName),
    keep: row.keep === true,
  };
}

function readBlocks(value: unknown): PlannedBlock[] {
  if (!Array.isArray(value)) return [];
  return value.map(readBlock).filter((block): block is PlannedBlock => block !== null);
}

export async function getDayPlan(employeeId: string, dayKey: string): Promise<StoredDayPlan | null> {
  const row = await prisma.dayPlan.findUnique({
    where: { employeeId_day: { employeeId, day: dayKeyToDate(dayKey) } },
    select: { blocks: true, notes: true, appliedAt: true, updatedAt: true },
  });
  if (!row) return null;

  return {
    blocks: readBlocks(row.blocks),
    notes: row.notes ? row.notes.split("\n").filter(Boolean) : [],
    appliedAt: row.appliedAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Writes the plan for a day, replacing whatever was there.
 *
 * Saving clears `appliedAt`: a plan that has been edited since it was put on
 * the board is no longer the plan that is on the board, and saying otherwise
 * would be a lie on the screen.
 */
export async function saveDayPlan(
  employeeId: string,
  dayKey: string,
  blocks: PlannedBlock[],
  notes: string[]
): Promise<void> {
  const day = dayKeyToDate(dayKey);
  const data = {
    blocks: blocks as unknown as object[],
    notes: notes.length > 0 ? notes.join("\n") : null,
    appliedAt: null,
  };

  await prisma.dayPlan.upsert({
    where: { employeeId_day: { employeeId, day } },
    create: { employeeId, day, ...data },
    update: data,
  });
}

/** Records that this plan has been put on the board. */
export async function markDayPlanApplied(employeeId: string, dayKey: string): Promise<void> {
  await prisma.dayPlan.update({
    where: { employeeId_day: { employeeId, day: dayKeyToDate(dayKey) } },
    data: { appliedAt: new Date() },
  });
}

export async function deleteDayPlan(employeeId: string, dayKey: string): Promise<void> {
  await prisma.dayPlan
    .delete({ where: { employeeId_day: { employeeId, day: dayKeyToDate(dayKey) } } })
    .catch(() => null);
}
