import { dayKeyIn, wallClockIn } from "@/lib/time";
import { isWorkingDay, minutesOf, type WorkHours } from "@/lib/work-hours";

// Turning a fingerprint device's punches into the one number payroll already
// understands: how many hours somebody arrived late on a given day.
//
// Pure on purpose, like work-hours.ts, because this decides money. Every rule
// here is arithmetic over a list of timestamps and the studio's working day —
// nothing reaches a device or a database, so all of it is testable without
// either.
//
// `AttendanceRecord.delayHours` already means exactly this: payroll computes
// `cutoff = hourly rate × hours arrived late`. So the device is not introducing
// a new measurement, it is filling in the one the manager types by hand today.

/** One read of a finger, as the device reports it. */
export type Punch = {
  /** The device's own user number — never an employee id; they are mapped. */
  deviceUserId: string;
  at: Date;
};

/** What one person's one day came to. */
export type DayAttendance = {
  deviceUserId: string;
  /** The calendar day in the company's timezone, YYYY-MM-DD. */
  dayKey: string;
  /** The first read of the day: when they arrived. */
  arrivedAt: Date;
  /** The last read of the day. Recorded, but nothing is deducted for it. */
  lastAt: Date;
  /** How many reads that day — one means they never touched it again. */
  punches: number;
  /** Hours late, to two decimals, never negative and never over 24. */
  delayHours: number;
};

/**
 * Minutes of lateness the studio lets pass.
 *
 * Zero until somebody says otherwise: a grace period is a policy about people's
 * pay, and inventing one here would quietly hand back money the studio never
 * agreed to give — or, read the other way, dock somebody for being ninety
 * seconds late. It is an argument rather than a constant so the answer lives in
 * one place when there is one.
 */
export const DEFAULT_GRACE_MINUTES = 0;

/** The most a single day can count for, matching what the manager's form allows. */
const MAX_DELAY_HOURS = 24;

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * How late an arrival at this wall-clock time is, in hours.
 *
 * Arriving early is not negative lateness — it is simply not late. Somebody who
 * comes in an hour before the day starts has not earned an hour back, and a
 * negative number here would silently pay them for it through payroll's
 * multiplication.
 */
export function lateHours(hours: WorkHours, arrival: string, graceMinutes = DEFAULT_GRACE_MINUTES): number {
  const arrivedAt = minutesOf(arrival);
  const startsAt = minutesOf(hours.start);
  if (arrivedAt == null || startsAt == null) return 0;

  const late = arrivedAt - startsAt - Math.max(0, graceMinutes);
  if (late <= 0) return 0;

  return round2(Math.min(late / 60, MAX_DELAY_HOURS));
}

/**
 * Punches grouped by the person and the calendar day they fall on **in the
 * company's timezone**.
 *
 * The day matters more than it looks: the database stores instants in UTC, and
 * Amman is three hours ahead, so a punch at 00:30 local is the previous day in
 * UTC. Grouping on the raw timestamp would put somebody's arrival on the wrong
 * day and, at the end of a month, in the wrong payslip.
 */
export function groupPunches(punches: Punch[], timeZone: string): Map<string, Punch[]> {
  const byKey = new Map<string, Punch[]>();

  for (const punch of punches) {
    if (!(punch.at instanceof Date) || Number.isNaN(punch.at.getTime())) continue;
    const key = `${punch.deviceUserId}|${dayKeyIn(timeZone, punch.at)}`;
    const list = byKey.get(key);
    if (list) list.push(punch);
    else byKey.set(key, [punch]);
  }

  return byKey;
}

/**
 * What the device's punches say about each person's each day.
 *
 * Days nobody works produce nothing at all. Somebody who comes in on a Friday
 * is not late for a day the studio is closed, and writing a zero row for it
 * would still count towards `delayDays` on the payroll screen — a day's
 * attendance recorded for a day there was none.
 */
export function attendanceFromPunches(
  punches: Punch[],
  hours: WorkHours,
  timeZone: string,
  graceMinutes = DEFAULT_GRACE_MINUTES
): DayAttendance[] {
  const grouped = groupPunches(punches, timeZone);
  const days: DayAttendance[] = [];

  for (const [key, list] of grouped) {
    const [deviceUserId, dayKey] = key.split("|");
    if (!isWorkingDay(hours, dayKey)) continue;

    const sorted = [...list].sort((a, b) => a.at.getTime() - b.at.getTime());
    const arrivedAt = sorted[0].at;
    const lastAt = sorted[sorted.length - 1].at;

    days.push({
      deviceUserId,
      dayKey,
      arrivedAt,
      lastAt,
      punches: sorted.length,
      delayHours: lateHours(hours, wallClockIn(timeZone, arrivedAt), graceMinutes),
    });
  }

  // Oldest first, so a sync writes a person's days in the order they happened.
  return days.sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.deviceUserId.localeCompare(b.deviceUserId));
}

/**
 * The wall clock a device reported, as a day and a time — nothing more.
 *
 * This exists because of a trap that cost a production release. The ZK library
 * builds its Dates from the numbers the machine sends — year, month, day, hour,
 * minute — through the *running process's* timezone. So the same device answer
 * becomes a different instant on a developer's laptop in Amman than it does
 * inside a container running UTC: three hours apart, silently.
 *
 * It read as harmless on the laptop and would have taken three hours off
 * everybody's pay every day in production, because an 11:00 arrival arrives
 * here as 14:00. The guard on clock drift is the only reason it never landed.
 *
 * The fix is to stop treating that Date as an instant at all. Reading its
 * components back with the same local getters recovers exactly the wall clock
 * the machine displayed, whatever timezone the process runs in — and the caller
 * then places that wall clock in the company's timezone, which is the only
 * place it ever meant anything.
 */
export function deviceWallClock(value: Date | string | null | undefined): { dayKey: string; time: string } | null {
  const at = value instanceof Date ? value : value ? new Date(value) : null;
  if (!at || Number.isNaN(at.getTime())) return null;

  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    dayKey: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  };
}

/**
 * The earliest day a sync may record, given what it was asked for.
 *
 * Anything missing or malformed becomes **today**, never "everything". The
 * device holds years of logs — this one had two — and writing them would put
 * lateness into payslips that were already paid, because payroll sums by
 * period and a settled month would gain deductions nobody ever charged.
 *
 * So the failure mode is chosen rather than inherited: a caller that forgets
 * the cutoff, or passes an empty box from a form, records one day. Reaching
 * further back has to be spelled out, which is what makes it a decision.
 */
export function cutoffFor(since: string | undefined | null, today: string): string {
  return typeof since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : today;
}

/** How an attendance row came to exist. */
export const MANUAL = "MANUAL";
export const DEVICE = "DEVICE";

/**
 * Whether a sync from the device may write over a row that is already there.
 *
 * **A manager's own figure always wins.** Somebody typed it *because* the
 * device was wrong, or off, or the person was at a site visit — so letting the
 * next sync overwrite it would undo a correction silently, in the one table
 * that decides what people are paid. The device may create a row, and may
 * update a row it wrote itself, and nothing else.
 */
export function mayDeviceWrite(existingSource: string | null | undefined): boolean {
  if (existingSource == null) return true;
  return existingSource === DEVICE;
}
