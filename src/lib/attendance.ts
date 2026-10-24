import { dayKeyIn, formatTimeIn, wallClockIn } from "@/lib/time";
import { hoursOn, isWorkingDay, minutesOf, type WorkHours } from "@/lib/work-hours";

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
  /**
   * The same moment as the studio reads a clock — "6:37 PM".
   *
   * Carried rather than derived later because this is the only place that knows
   * the timezone. Written as UTC once, it told a manager somebody arrived at
   * 15:37 when the machine had said 18:37: unambiguous to a machine, and simply
   * wrong to the person reading the screen.
   */
  arrivedLocal: string;
  /** The last read of the day. Not necessarily a clock-out — see `departedAt`. */
  lastAt: Date;
  /** The last read on the studio's clock, for a screen. */
  lastLocal: string;
  /**
   * What leaving at the last read would cost, in hours — whether or not it is
   * called a departure here. A day whose arrival the manager set measures the
   * departure against that arrival instead of the first read (`departureAfter`).
   */
  earlyAtLast: number;
  /**
   * When they clocked out, where they did.
   *
   * Null when the last read cannot honestly be called a departure: a single
   * read, or a second one so soon after the first that it is somebody scanning
   * twice on the way in. The platform cannot tell that from a person who
   * arrived and left twenty minutes later, and guessing costs a day's pay — so
   * it says nothing instead.
   */
  departedAt: Date | null;
  /** The same moment on the studio's clock, for the screen. Null with the above. */
  departedLocal: string | null;
  /** How many reads that day — one means they never touched it again. */
  punches: number;
  /** Hours late, to two decimals, never negative and never over 24. */
  delayHours: number;
  /** Hours of the day left unworked at the end. Zero when nobody clocked out. */
  earlyHours: number;
};

/**
 * Minutes of lateness the studio lets pass, when nobody has said.
 *
 * Zero on purpose: an allowance is a policy about people's pay, and inventing
 * one here would quietly hand back money the studio never agreed to give — or,
 * read the other way, dock somebody for being ninety seconds late.
 *
 * This studio has since said five minutes, and that answer lives where the rest
 * of the working day lives: `WorkHours.graceMinutes`, edited in Settings. This
 * stays zero as the fallback for an installation that has not chosen.
 */
export const DEFAULT_GRACE_MINUTES = 0;

/** The most a single day can count for, matching what the manager's form allows. */
const MAX_DELAY_HOURS = 24;

/**
 * How late an arrival at this wall-clock time is, in hours.
 *
 * Two rules the studio set, and both cost money, so both are here rather than
 * in a screen or a query:
 *
 * - **An allowance, then nothing forgiven.** Minutes up to `graceMinutes` past
 *   the start are not late at all — 11:05 on an 11:00 day. A minute past it is.
 * - **Charged in whole hours, rounded up.** 11:06 is an hour, 12:40 is two,
 *   14:20 is four. The studio asked for this deliberately: the point is that
 *   being late costs something worth avoiding, not that the arithmetic is
 *   exact. Anything partial rounds against the latecomer, never the studio.
 *
 * Arriving early is not negative lateness — it is simply not late. Somebody who
 * comes in an hour before the day starts has not earned an hour back, and a
 * negative number here would silently pay them for it through payroll's
 * multiplication.
 */
export function lateHours(hours: WorkHours, arrival: string, graceMinutes = hours.graceMinutes ?? DEFAULT_GRACE_MINUTES): number {
  const arrivedAt = minutesOf(arrival);
  const startsAt = minutesOf(hours.start);
  if (arrivedAt == null || startsAt == null) return 0;

  const late = arrivedAt - startsAt - Math.max(0, graceMinutes);
  if (late <= 0) return 0;

  // Rounded up rather than to two decimals: a part of an hour is an hour.
  return Math.min(Math.ceil(late / 60), MAX_DELAY_HOURS);
}

/**
 * The shortest gap between two reads that can be a day's work rather than one
 * arrival.
 *
 * A guard, not a policy. Somebody scanning twice on the way in — because the
 * first read did not beep — leaves two punches minutes apart, and reading the
 * second as a clock-out would cut nearly a whole day's pay from somebody who
 * did nothing wrong. Below this, the day is treated as having no clock-out at
 * all, which deducts nothing and says so.
 *
 * It costs the studio the rare case of a genuinely twenty-minute day, which is
 * the right way round: an unclaimed hour is an annoyance, an invented one is a
 * wrong payslip.
 */
const MIN_SHIFT_MINUTES = 60;

/**
 * How much of the day was left unworked by leaving at this wall-clock time.
 *
 * The other end of the studio's lateness rule, and deliberately not identical
 * to it:
 *
 * - **Charged in whole hours, rounded up**, exactly as lateness is. 17:20 on a
 *   day ending at 19:00 is two hours.
 * - **No allowance.** The studio asked for the five minutes at the start of
 *   the day and not at the end, so a minute before the end is an hour: 18:59
 *   costs one. That is a decision about people's pay and it is theirs to make,
 *   not one to be softened here.
 *
 * Staying past the end is not negative — there is no overtime in this studio,
 * and a negative number here would quietly pay it through payroll's
 * multiplication, which is exactly the trap `lateHours` avoids at its own end.
 */
export function earlyHours(hours: WorkHours, departure: string): number {
  const leftAt = minutesOf(departure);
  const endsAt = minutesOf(hours.end);
  if (leftAt == null || endsAt == null) return 0;

  const early = endsAt - leftAt;
  if (early <= 0) return 0;

  return Math.min(Math.ceil(early / 60), MAX_DELAY_HOURS);
}

/**
 * When somebody's own day ends, as minutes past that day's midnight.
 *
 * The studio's day is a fixed length — 11:00 to 19:00 here, an hour shorter on
 * Saturday — and the studio asked that it stay that length however it is
 * worked. Arriving late does not shorten it, and stepping out in the middle
 * does not either: both push the end back by the same amount, so what is owed
 * is always the same eight hours.
 *
 * Minutes rather than "HH:MM" because a day that began late can end after
 * midnight — arriving at 4:08 PM owes until 00:03 — and a clock face cannot
 * say that while a number can. 1443 is three minutes past midnight, on the day
 * after the one that started.
 *
 * The allowance comes off before anything moves: arriving at 11:05 with five
 * minutes' grace is not late, so that day still ends at 19:00. Arriving early
 * does not move it either — there is no credit for turning up at ten.
 */
export function endOfDayMinutes(
  hours: WorkHours,
  dayKey: string,
  arrival: string,
  awayMinutes = 0,
  graceMinutes = hours.graceMinutes ?? DEFAULT_GRACE_MINUTES
): number {
  // That day's own end: Saturday's is earlier, and reading `end` directly is
  // how Saturday gets charged an extra hour.
  const today = hoursOn(hours, dayKey);
  const end = minutesOf(today.end);
  if (end == null) return 0;

  const start = minutesOf(today.start);
  const arrived = minutesOf(arrival);
  // An arrival nobody can read moves nothing, which leaves the studio's own
  // end standing and charges no more than the old rule did.
  const late =
    start != null && arrived != null ? Math.max(0, arrived - start - Math.max(0, graceMinutes)) : 0;

  return end + late + Math.max(0, awayMinutes);
}

/**
 * How much of the day was still owed when somebody left — the one number this
 * rule charges.
 *
 * Lateness and time stepped out are not charged in themselves any more: they
 * have already moved `endMinutes`. So a day worked to its own end costs
 * nothing however it was arranged, and a day cut short costs the difference
 * whatever the reason.
 *
 * Whole hours rounded up and never negative, exactly as lateness is charged:
 * the studio asked for its allowance at the start of the day only, and staying
 * past the end earns nothing — a negative here would pay overtime through
 * payroll's multiplication.
 *
 * No clock-out costs nothing. The device cannot tell a forgotten scan from an
 * early finish, and it must not invent one.
 */
export function hoursShort(endMinutes: number, departureMinutes: number | null | undefined): number {
  if (departureMinutes == null || !Number.isFinite(departureMinutes)) return 0;
  const short = endMinutes - departureMinutes;
  if (short <= 0) return 0;
  return Math.min(Math.ceil(short / 60), MAX_DELAY_HOURS);
}

/**
 * A wall-clock time in the working day's own frame, so it can be compared with
 * `endOfDayMinutes`.
 *
 * A clock-out earlier on the clock than the arrival it belongs to happened
 * after midnight: 00:08 is not eight minutes into a day that started at 4 PM,
 * it is 1448. Reading it as the former is how a day that ran late reads as one
 * that ended before it began — and it is the same midnight that put Salem's
 * clock-out on the following morning as an arrival.
 */
export function minutesInDay(time: string, startedAt: string): number | null {
  const minute = minutesOf(time);
  const from = minutesOf(startedAt);
  if (minute == null || from == null) return null;
  return minute < from ? minute + 24 * 60 : minute;
}

/**
 * What a day costs, in hours — the one number payroll multiplies by the rate.
 *
 * Used by every path that writes a day, so the device, a corrected row and a
 * manager's own edit cannot drift into charging differently for the same
 * afternoon.
 *
 * A day with times is measured against the end THIS person owed: the studio's
 * day, pushed back by however late they were and however long they stepped
 * out. Work to that end and the day costs nothing, however it was arranged.
 *
 * A day with no times keeps the older meaning — whatever the manager typed —
 * because there is nothing to measure against and their figure is the whole
 * record of it.
 */
export function chargedHours(input: {
  hours: WorkHours;
  timeZone: string;
  dayKey: string;
  arrivedAt: Date | null;
  departedAt: Date | null;
  /** From the step-outs on the row (lib/attendance-breaks.ts). */
  awayMinutes?: number;
  /** What the manager typed, for a day that has no times at all. */
  typed?: { delayHours: number; earlyHours: number; awayHours: number };
}): number {
  const { hours, timeZone, dayKey, arrivedAt, departedAt } = input;

  if (!arrivedAt) {
    const typed = input.typed;
    if (!typed) return 0;
    return Math.max(0, typed.delayHours) + Math.max(0, typed.earlyHours) + Math.max(0, typed.awayHours);
  }

  const arrival = wallClockIn(timeZone, arrivedAt);
  const owedUntil = endOfDayMinutes(hours, dayKey, arrival, input.awayMinutes ?? 0);
  // No clock-out costs nothing: the device cannot tell a forgotten scan from an
  // early finish, and this must not invent one.
  const left = departedAt ? minutesInDay(wallClockIn(timeZone, departedAt), arrival) : null;
  return hoursShort(owedUntil, left);
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
  // Taken from the working day it was handed, not from a constant: a caller who
  // forgets this argument then gets the studio's real allowance rather than
  // silently charging everybody from the first minute. The sync and the check
  // script both rely on that.
  graceMinutes = hours.graceMinutes ?? DEFAULT_GRACE_MINUTES
): DayAttendance[] {
  const grouped = groupPunches(punches, timeZone);
  const days: DayAttendance[] = [];

  for (const [key, list] of grouped) {
    const [deviceUserId, dayKey] = key.split("|");
    if (!isWorkingDay(hours, dayKey)) continue;

    const sorted = [...list].sort((a, b) => a.at.getTime() - b.at.getTime());
    const arrivedAt = sorted[0].at;
    const lastAt = sorted[sorted.length - 1].at;

    // A clock-out only where the last read can honestly be one — see
    // MIN_SHIFT_MINUTES. Everything else about the day stands either way.
    const worked = (lastAt.getTime() - arrivedAt.getTime()) / 60_000;
    const departedAt = worked >= MIN_SHIFT_MINUTES ? lastAt : null;

    days.push({
      deviceUserId,
      dayKey,
      arrivedAt,
      arrivedLocal: formatTimeIn(timeZone, arrivedAt) ?? wallClockIn(timeZone, arrivedAt),
      lastAt,
      lastLocal: formatTimeIn(timeZone, lastAt) ?? wallClockIn(timeZone, lastAt),
      // Against that day's own end: Saturday's is earlier.
      earlyAtLast: earlyHours(hoursOn(hours, dayKey), wallClockIn(timeZone, lastAt)),
      departedAt,
      departedLocal: departedAt ? formatTimeIn(timeZone, departedAt) ?? wallClockIn(timeZone, departedAt) : null,
      punches: sorted.length,
      delayHours: lateHours(hours, wallClockIn(timeZone, arrivedAt), graceMinutes),
      // Nothing is deducted for a day nobody clocked out of: the device cannot
      // tell a forgotten scan from an early finish, and it must not invent one.
      earlyHours: departedAt ? earlyHours(hoursOn(hours, dayKey), wallClockIn(timeZone, departedAt)) : 0,
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
export function deviceWallClock(
  value: Date | string | null | undefined
): { dayKey: string; time: string; seconds: number } | null {
  const at = value instanceof Date ? value : value ? new Date(value) : null;
  if (!at || Number.isNaN(at.getTime())) return null;

  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    dayKey: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
    // Carried separately because instantAt speaks HH:MM. Dropping them made a
    // correct clock report as up to 59 seconds slow — a number invented by the
    // reading rather than found on the device, and one I briefly mistook for a
    // failing battery.
    seconds: at.getSeconds(),
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
 * The manager set when somebody arrived — they came in on time and forgot to
 * clock in — and the device still records when they leave.
 *
 * MANUAL would have kept the arrival safe and lost the other end: a sync never
 * touches a MANUAL row, so the clock-out that evening would go unrecorded, the
 * clock-out reminders would chase somebody who had just clocked out, and
 * leaving early would cost nothing. So this row is the manager's at the start
 * of the day and the device's at the end of it (`departureAfter`).
 */
export const ARRIVAL = "ARRIVAL";

/**
 * The other end of a day whose arrival the manager set: the device's last read,
 * measured against that arrival rather than against the first read.
 *
 * **The first read of such a day is the forgotten clock-in, never a departure.**
 * Somebody who forgot to clock in scans when they remember — on 2026-10-19 at
 * 1:37 PM — and taken as a clock-out that would have charged six hours of
 * leaving early. So a departure needs a second read. One read and no more
 * leaves the day without a clock-out, which costs nothing and is chased by the
 * evening's reminders until they scan again.
 *
 * Otherwise the same rule as every other day: a last read within an hour of
 * the arrival is not called a departure, and leaving early is charged as
 * `earlyHours` does.
 */
export function departureAfter(
  arrivedAt: Date,
  day: Pick<DayAttendance, "lastAt" | "lastLocal" | "earlyAtLast" | "punches">
) {
  const worked = (day.lastAt.getTime() - arrivedAt.getTime()) / 60_000;
  if (day.punches < 2 || worked < MIN_SHIFT_MINUTES) return { departedAt: null, departedLocal: null, earlyHours: 0 };
  return { departedAt: day.lastAt, departedLocal: day.lastLocal, earlyHours: day.earlyAtLast };
}

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
