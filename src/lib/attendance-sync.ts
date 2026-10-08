import { attendanceFromPunches, cutoffFor } from "@/lib/attendance";
import { readClock, readPunches, type DeviceAddress, type DeviceClock } from "@/lib/attendance-device";
import { currentDeviceAddress, relocateDevice, rememberDevice } from "@/lib/attendance-locate";
import { applyAttendance, type SyncOutcome } from "@/lib/attendance-store";
import { getSetting, getTimezone, getWorkHours, setSetting } from "@/lib/settings";
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

/** When a sync last read the device and wrote what it saw (an ISO moment). */
export const LAST_SYNC_KEY = "attendance_last_sync_ok";

// The device takes one conversation at a time, and the clock reminders now
// read it every minute or two beside the ten-minute pass: two syncs asked for
// at once share the one already running rather than talking over each other.
let running: Promise<SyncReport> | null = null;

export async function syncAttendance(options: SyncOptions = {}, now = new Date()): Promise<SyncReport> {
  if (options.since) return syncOnce(options, now);
  if (!running) {
    running = syncOnce(options, now).finally(() => {
      running = null;
    });
  }
  return running;
}

/**
 * A sync, unless one finished within `maxAgeSeconds` — for the clock
 * reminders, which must not tell somebody to clock in a minute after they did,
 * and must not read the device sixty times an hour either. Answers when the
 * device was last read successfully, which is what decides whether anything
 * may be said at all.
 */
export async function syncAttendanceIfStale(maxAgeSeconds: number, now = new Date()): Promise<Date | null> {
  const last = await getSetting(LAST_SYNC_KEY);
  const lastAt = last ? new Date(last) : null;
  if (lastAt && !Number.isNaN(lastAt.getTime()) && (now.getTime() - lastAt.getTime()) / 1000 < maxAgeSeconds) {
    return lastAt;
  }
  const report = await syncAttendance({}, now);
  if (report.ran) return new Date();
  return lastAt && !Number.isNaN(lastAt.getTime()) ? lastAt : null;
}

async function syncOnce(options: SyncOptions, now: Date): Promise<SyncReport> {
  // Where the device is now, not where it was configured: the router hands it
  // its address, and has changed it before (lib/attendance-find.ts).
  const at = await currentDeviceAddress();
  // No address means the studio has no device, or this is somebody's laptop.
  // Silence is the right answer, the same as an absent ANTHROPIC_API_KEY.
  if (!at) return { ran: false, reason: "no-device-configured" };

  const first = await readAndWrite(at, options, now);
  if (first.report.ran) {
    // The first time it is read, note which machine it is — a later search
    // needs a serial to hold a candidate to.
    await rememberDevice(at, now);
    return first.report;
  }
  if (!first.silent) return first.report;

  // It did not answer where it was. Before saying so, look for it: on
  // 2026-10-04 the router moved it one address along and nothing was recorded
  // for four days. Rate-limited inside, so an unplugged device is not searched
  // for by every pass.
  const moved = await relocateDevice(at, now);
  return moved ? (await readAndWrite(moved, options, now)).report : first.report;
}

/**
 * One reading of the device at one address. `silent` says the machine itself
 * did not answer — as opposed to answering and something after that failing —
 * which is the only case worth searching the network over.
 */
async function readAndWrite(
  at: DeviceAddress,
  options: SyncOptions,
  now: Date
): Promise<{ report: SyncReport; silent: boolean }> {
  try {
    // The studio's timezone before anything else. The device knows only wall
    // clock, and which instant that was is unanswerable without it — not even
    // to tell whether the clock is right.
    const timeZone = await getTimezone();

    // The clock next, on its own connection: if it is wrong there is no point
    // reading the log at all, and the answer is the thing worth saying.
    let clock: DeviceClock;
    try {
      clock = await readClock(at, timeZone, now);
    } catch (error) {
      return { silent: true, report: { ran: false, reason: "unreachable", error: sayDeviceError(error) } };
    }
    if (Math.abs(clock.driftSeconds) > MAX_DRIFT_SECONDS) {
      return {
        silent: false,
        report: {
          ran: false,
          reason: "clock-wrong",
          driftSeconds: clock.driftSeconds,
          // What the machine displays, not an instant: a clock nobody can read
          // has no instant, and asking an invalid Date for one throws.
          deviceTime: clock.wallClock,
        },
      };
    }

    const punches = await readPunches(at, timeZone);
    // Read one after the other, like the other multi-query paths here.
    const hours = await getWorkHours();

    const all = attendanceFromPunches(punches, hours, timeZone);
    const since = cutoffFor(options.since, dayKeyIn(timeZone, now));
    const days = all.filter((day) => day.dayKey >= since);
    const outcome = await applyAttendance(days);
    await setSetting(LAST_SYNC_KEY, new Date().toISOString()).catch(() => undefined);

    return {
      silent: false,
      report: {
        ran: true,
        punches: punches.length,
        days: days.length,
        driftSeconds: clock.driftSeconds,
        outcome,
      },
    };
  } catch (error) {
    return {
      silent: false,
      report: { ran: false, reason: "unreachable", error: sayDeviceError(error) },
    };
  }
}

/**
 * What went wrong, in words.
 *
 * The device library rejects with a plain object — `{ err, ip, command }` —
 * not an Error, so `String(error)` put **"[object Object]"** on the manager's
 * screen and in the scheduler's log for as long as the device was unreachable.
 */
function sayDeviceError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const inner = (error as { err?: unknown; message?: unknown; code?: unknown }) ?? {};
    const cause = inner.err instanceof Error ? inner.err.message : inner.err;
    const said = [inner.message, cause, inner.code].find((part) => typeof part === "string" && part.trim());
    if (typeof said === "string") return said;
    return "the device did not answer";
  }
  return String(error);
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
