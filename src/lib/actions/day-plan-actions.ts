"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { proposeDay, type DayPlanResult } from "@/lib/ai/day-plan";
import { getDayPlan, markDayPlanApplied, saveDayPlan } from "@/lib/day-plan-store";
import { ownedBy } from "@/lib/employee-tasks";
import { notifyTaskUpdated, snapshotOf } from "@/lib/notifications/events";
import { getTimezone } from "@/lib/settings";
import { dayKeyToDate, instantAt } from "@/lib/time";
import type { PlannedBlock } from "@/lib/day-plan";

// Proposing a day, editing it, and putting it on the board. Admin only: these
// are public endpoints, and one of them reads out an employee's whole workload
// while another moves real work onto a real day.

async function requireAdmin() {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) {
    throw new Error("Unauthorized");
  }
}

export async function planEmployeeDay(employeeId: string, dayKey: string): Promise<DayPlanResult> {
  await requireAdmin();
  const result = await proposeDay(employeeId, dayKey);
  revalidatePath("/admin/employees", "layout");
  return result;
}

/**
 * The manager's edits: which blocks stay, and at what times.
 *
 * Only the parts a person can actually change are taken from the browser. The
 * task a block belongs to is looked up again here rather than trusted, so a
 * block can never be pointed at somebody else's work on its way back.
 */
export async function saveDayPlanEdits(
  employeeId: string,
  dayKey: string,
  edits: { from: string; to: string; keep: boolean }[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();

  const stored = await getDayPlan(employeeId, dayKey);
  if (!stored) return { ok: false, error: "There is no plan for that day any more." };
  if (edits.length !== stored.blocks.length) {
    return { ok: false, error: "That plan changed while you were editing it. Open it again." };
  }

  const blocks: PlannedBlock[] = stored.blocks.map((block, index) => ({
    ...block,
    from: edits[index].from || block.from,
    to: edits[index].to || block.to,
    keep: edits[index].keep === true,
  }));

  await saveDayPlan(employeeId, dayKey, blocks, stored.notes);
  revalidatePath("/admin/employees", "layout");
  return { ok: true };
}

/**
 * Puts the plan on the day.
 *
 * The blocks come from what was saved, never from the browser, and every one
 * of them is checked to be this employee's own work before anything moves. A
 * block with no task behind it — a break, a journey — has nothing to put on a
 * board and is simply skipped.
 */
export async function applyDayPlan(
  employeeId: string,
  dayKey: string
): Promise<{ ok: true; moved: number } | { ok: false; error: string }> {
  await requireAdmin();

  const stored = await getDayPlan(employeeId, dayKey);
  if (!stored) return { ok: false, error: "There is no plan for that day any more." };

  const wanted = stored.blocks.filter((block) => block.keep && block.entryId);
  if (wanted.length === 0) return { ok: false, error: "Nothing is ticked to put on the day." };

  // Their own work only, by the same ownership rule the board uses.
  const mine = await prisma.projectTaskEntry.findMany({
    where: { AND: [{ id: { in: wanted.map((block) => block.entryId as string) } }, await ownedBy(employeeId)] },
    select: { id: true },
  });
  const allowed = new Set(mine.map((row) => row.id));

  const timezone = await getTimezone();
  const day = dayKeyToDate(dayKey);
  let moved = 0;

  for (const block of wanted) {
    const entryId = block.entryId as string;
    if (!allowed.has(entryId)) continue;

    const before = await prisma.projectTaskEntry.findUnique({
      where: { id: entryId },
      include: { task: { select: { name: true } } },
    });
    if (!before) continue;

    // The block's end is the time it is wanted by. Only the day and that
    // deadline move — notes, priority and everything else are the manager's.
    const entry = await prisma.projectTaskEntry.update({
      where: { id: entryId },
      data: { scheduledFor: day, dueAt: instantAt(dayKey, block.to, timezone) },
      include: { task: { select: { name: true } } },
    });

    await notifyTaskUpdated(entryId, snapshotOf(before), snapshotOf(entry));
    moved += 1;
  }

  await markDayPlanApplied(employeeId, dayKey);

  revalidatePath("/admin/employees", "layout");
  revalidatePath("/admin/tasks");
  revalidatePath("/employee", "layout");
  return { ok: true, moved };
}
