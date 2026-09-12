import { getDayPlan } from "@/lib/day-plan-store";
import { getTimezone, getWorkHours } from "@/lib/settings";
import { nowAndNext, type NowNext, type PlanSlot } from "@/lib/now-next";
import { todayKey, wallClockIn } from "@/lib/time";
import type { WorkHours } from "@/lib/work-hours";

// Reading one person's place in their own day.
//
// The arithmetic is in lib/now-next.ts, where it is tested without a clock or a
// database. This only fetches: the day's plan as it was published, the studio's
// hours, and what time it actually is where the studio is.

export async function myDay(employeeId: string): Promise<{ state: NowNext; hours: WorkHours; dayKey: string }> {
  // One after another, the convention everywhere here.
  const timezone = await getTimezone();
  const hours = await getWorkHours();
  const dayKey = todayKey(timezone);
  const plan = await getDayPlan(employeeId, dayKey);

  // Only a plan that was actually put on the day counts: a draft nobody
  // published is not something to tell somebody they are late for.
  const blocks: PlanSlot[] =
    plan?.appliedAt == null
      ? []
      : plan.blocks.map((block) => ({
          from: block.from,
          to: block.to,
          what: block.what,
          keep: block.keep,
          entryId: block.entryId,
          jobId: block.jobId,
        }));

  return { state: nowAndNext(blocks, hours, wallClockIn(timezone)), hours, dayKey };
}
