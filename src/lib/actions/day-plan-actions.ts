"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { proposeDay, type DayPlanResult } from "@/lib/ai/day-plan";
import { getDayPlan, markDayPlanApplied, saveDayPlan } from "@/lib/day-plan-store";
import { ownedBy } from "@/lib/employee-tasks";
import { dispatchNotification } from "@/lib/notifications/engine";
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

/** Where a notification about a job lands, as the week board's own action has it. */
const jobUrl = (id: string) => `/employee/assigned/${id}`;

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
 * Puts the plan on the day — all of it, not only the part that came from the
 * board.
 *
 * A block that names a step of a project schedules that cell. A block that
 * names none is the rest of the working day — calls, visits, an hour of
 * outreach — and becomes a job on the week board for that day, exactly like one
 * handed out by hand. Both tell the employee through the same engine.
 *
 * The blocks come from what was saved, never from the browser, and every cell
 * is checked to be this employee's own work before anything moves. A block that
 * has already been made into a job carries its id, so pressing this twice does
 * not hand out the same work twice.
 */
export async function applyDayPlan(
  employeeId: string,
  dayKey: string
): Promise<{ ok: true; moved: number; jobs: number } | { ok: false; error: string }> {
  await requireAdmin();

  const stored = await getDayPlan(employeeId, dayKey);
  if (!stored) return { ok: false, error: "There is no plan for that day any more." };

  const kept = stored.blocks.filter((block) => block.keep);
  if (kept.length === 0) return { ok: false, error: "Nothing is ticked to put on the day." };

  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, active: true },
    select: { id: true },
  });
  if (!employee) return { ok: false, error: "That employee is not available." };

  // Their own work only, by the same ownership rule the board uses.
  const cells = kept.map((block) => block.entryId).filter((id): id is string => Boolean(id));
  const mine = cells.length
    ? await prisma.projectTaskEntry.findMany({
        where: { AND: [{ id: { in: cells } }, await ownedBy(employeeId)] },
        select: { id: true },
      })
    : [];
  const allowed = new Set(mine.map((row) => row.id));

  const timezone = await getTimezone();
  const day = dayKeyToDate(dayKey);
  const next: PlannedBlock[] = [];
  let moved = 0;
  let jobs = 0;

  for (const block of stored.blocks) {
    if (!block.keep) {
      next.push(block);
      continue;
    }

    // A step of a project: schedule the cell it stands for.
    if (block.entryId) {
      if (!allowed.has(block.entryId)) {
        next.push(block);
        continue;
      }

      const before = await prisma.projectTaskEntry.findUnique({
        where: { id: block.entryId },
        include: { task: { select: { name: true } } },
      });
      if (!before) {
        next.push(block);
        continue;
      }

      // Only the day and the deadline move; notes, priority and the rest of
      // the cell are the manager's.
      const entry = await prisma.projectTaskEntry.update({
        where: { id: block.entryId },
        data: { scheduledFor: day, dueAt: instantAt(dayKey, block.to, timezone) },
        include: { task: { select: { name: true } } },
      });

      await notifyTaskUpdated(block.entryId, snapshotOf(before), snapshotOf(entry));
      moved += 1;
      next.push(block);
      continue;
    }

    // Everything else: a job for that one day, on the week board.
    const title = block.what.trim().slice(0, 200);
    if (!title || block.jobId) {
      next.push(block);
      continue;
    }

    const job = await prisma.assignedTask.create({
      data: {
        employeeId,
        title,
        note: block.why,
        startDay: day,
        endDay: day,
      },
    });

    await dispatchNotification({
      employeeId,
      type: "TASK_ASSIGNED",
      title: "New Task Assigned",
      message: `${title} — today's job.`,
      url: jobUrl(job.id),
      dedupeKey: `ASSIGNED_TASK:${job.id}`,
      metadata: { days: 1 },
    }).catch(() => {
      // The work is recorded; a failed push must not undo that.
    });

    jobs += 1;
    next.push({ ...block, jobId: job.id });
  }

  // Saving clears the applied stamp, so it is set after the blocks are written.
  await saveDayPlan(employeeId, dayKey, next, stored.notes);
  await markDayPlanApplied(employeeId, dayKey);

  revalidatePath("/admin/employees", "layout");
  revalidatePath("/admin/tasks");
  revalidatePath("/employee", "layout");
  return { ok: true, moved, jobs };
}
