import { attendanceFromPunches, cutoffFor } from "@/lib/attendance";
import { deviceAddress, readClock, readPunches } from "@/lib/attendance-device";
import { applyAttendance, type SyncOutcome } from "@/lib/attendance-store";
import { getTimezone, getWorkHours } from "@/lib/settings";
import { dayKeyIn } from "@/lib/time";

// One pass of "ask the machine what it saw, and write it down".
//
// Everything it needs is already decided elsewhere — the studio's hours, the
// company timezone, who is paired with which number — so this only puts them in
// order and reports what happened. It never throws into its caller: a scheduled
// job that dies because a device is unplugged takes the rest of the pass with
// it, and the other jobs on that endpoint have nothing to do with attendance.

/**
 * How far out the device's clock may be before a sync refuses to write.
 *
 * Ten minutes. This device was found set to **November 2000** with a nine-month
 * hole in its log — a dead backup battery. Syncing in that state is worse than
 * not syncing: every arrival is filed under a day nobody will ever look at, and
 * the lateness attached to it is fiction that payroll would nonetheless charge
 * somebody for. A wrong clock is a fault to report, not data to record.
 */
export const MAX_DRIFT_SECONDS = 600;

export type SyncReport =
  | { ran: false; reason: "no-device-configured" }
  | { ran: false; reason: "unreachable"; error: string }
  | { ran: false; reason: "clock-wrong"; driftSeconds: number; deviceTime: string }
  | {
      ran: true;
      punches: number;
      days: number;
      driftSeconds: number;
      outcome: SyncOutcome;
    };

export type SyncOptions = {
  /**
   * The earliest day to record, as YYYY-MM-DD. **Defaults to today**, and days
   * before it are read and then dropped.
   *
   * Today rather than "everything" on purpose. This device was found holding
   * two years of logs, and writing them would have put lateness into payslips
   * that were already paid — payroll sums by period, so a settled month would
   * quietly gain deductions nobody ever charged. The device's memory is not the
   * studio's history.
   *
   * So the safe answer is the default one: a caller that forgets this argument
   * records today, never two years. Widening it is a deliberate act, which is
   * what it should be.
   */
  since?: string;
};

export async function syncAttendance(options: SyncOptions = {}, now = new Date()): Promise<SyncReport> {
  const at = deviceAddress();
  // No address means the studio has no device, or this is somebody's laptop.
  // Silence is the right answer, the same as an absent ANTHROPIC_API_KEY.
  if (!at) return { ran: false, reason: "no-device-configured" };

  try {
    // The clock first, and on its own connection: if it is wrong there is no
    // point reading the log at all, and the answer is the thing worth saying.
    const clock = await readClock(at, now);
    if (Math.abs(clock.driftSeconds) > MAX_DRIFT_SECONDS) {
      return {
        ran: false,
        reason: "clock-wrong",
        driftSeconds: clock.driftSeconds,
        deviceTime: clock.deviceTime.toISOString(),
      };
    }

    const punches = await readPunches(at);
    // Read one after the other, like the other multi-query paths here.
    const hours = await getWorkHours();
    const timeZone = await getTimezone();

    const all = attendanceFromPunches(punches, hours, timeZone);
    const since = cutoffFor(options.since, dayKeyIn(timeZone, now));
    const days = all.filter((day) => day.dayKey >= since);
    const outcome = await applyAttendance(days);

    return {
      ran: true,
      punches: punches.length,
      days: days.length,
      driftSeconds: clock.driftSeconds,
      outcome,
    };
  } catch (error) {
    return {
      ran: false,
      reason: "unreachable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The same pass, said in one line for a scheduler's log. */
export function describeSync(report: SyncReport): string {
  if (!report.ran) {
    if (report.reason === "no-device-configured") return "attendance: no device configured";
    if (report.reason === "unreachable") return `attendance: device unreachable (${report.error})`;
    return `attendance: device clock is out by ${report.driftSeconds}s (${report.deviceTime}) — nothing written`;
  }

  const { outcome } = report;
  const parts = [
    `${report.punches} punches`,
    `${report.days} days`,
    `${outcome.created} new`,
    `${outcome.updated} updated`,
  ];
  if (outcome.keptManual > 0) parts.push(`${outcome.keptManual} left as the manager set them`);
  if (outcome.skippedInactive > 0) parts.push(`${outcome.skippedInactive} skipped (not on the team)`);
  if (outcome.unmapped.length > 0) parts.push(`unpaired device numbers: ${outcome.unmapped.join(", ")}`);

  return `attendance: ${parts.join(", ")}`;
}
