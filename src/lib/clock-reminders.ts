import { hoursOn, isWorkingDay, timeOf, type WorkHours } from "@/lib/work-hours";
import { endOfDayMinutes } from "@/lib/attendance";
import { instantAt, wallClockIn } from "@/lib/time";

// Reminding somebody to clock in and out on the fingerprint device — when, and
// to whom. Pure, so the timing is pinned by tests rather than by hope; the
// runner (lib/notifications/clock-events.ts) does the reading and the sending.
//
// What the studio asked for:
// - from the start of the day, somebody the device has not seen is told
//   "Clock in" every two minutes until it sees them;
// - ten minutes before the end, somebody still in is told once to clock out;
// - from the end, somebody who clocked in and not out is told every two
//   minutes until they do.
//
// Two limits the studio did not ask for and needs anyway, because the device
// cannot tell "didn't come in" from "didn't punch": the chasing stops an hour
// after the start (or the end), and the manager is told once instead — in
// words that say what the device saw, never that somebody was absent.

export const REPEAT_SECONDS = 110; // "every two minutes", on a scheduler that ticks every 60 s
export const CHASE_MINUTES = 60;
export const OUT_WARNING_MINUTES = 10;

export type ClockKind = "in" | "out-soon" | "out" | "in-missed" | "out-missed";

export type ClockPerson = {
  id: string;
  arrivedAt: Date | null;
  departedAt: Date | null;
  /**
   * When THIS person's day ends. The studio's own end when nothing is known
   * about theirs — somebody the device has not seen has no day of their own yet.
   */
  endsAt?: Date | null;
};

/**
 * When somebody's own day ends, as an instant.
 *
 * The studio's end is only the start of the answer: a day that began late, or
 * was stepped out of, is owed until later. Chasing somebody to clock out at
 * 7:00 PM when they were told on arrival that they finish at 10:00 is the
 * platform contradicting itself, in the one place it decides money.
 */
export function endForPerson(
  hours: WorkHours,
  dayKey: string,
  timeZone: string,
  arrivedAt: Date | null,
  awayMinutes = 0
): Date | null {
  if (!arrivedAt) return null;

  const minutes = endOfDayMinutes(hours, dayKey, wallClockIn(timeZone, arrivedAt), awayMinutes);
  const dayPart = Math.floor(minutes / (24 * 60));
  const base = instantAt(dayKey, timeOf(minutes % (24 * 60)), timeZone);
  // Past midnight the day carries into the next morning rather than wrapping
  // back round to its own.
  return base ? new Date(base.getTime() + dayPart * 24 * 60 * 60_000) : null;
}

export type ClockSent = { kind: ClockKind; lastAt: Date };

export type ClockDue = { employeeId: string; kind: ClockKind };

/** The moments the day's reminders hang off, or null on a day nobody works. */
export function clockWindows(hours: WorkHours, dayKey: string, timeZone: string) {
  if (!isWorkingDay(hours, dayKey)) return null;
  const start = instantAt(dayKey, hours.start, timeZone);
  const end = instantAt(dayKey, hoursOn(hours, dayKey).end, timeZone);
  if (!start || !end || end <= start) return null;
  const minute = 60_000;
  return {
    start,
    end,
    inUntil: new Date(start.getTime() + CHASE_MINUTES * minute),
    outSoonFrom: new Date(end.getTime() - OUT_WARNING_MINUTES * minute),
    outUntil: new Date(end.getTime() + CHASE_MINUTES * minute),
  };
}

/** Whether anything could be due now — so the device is only read when it matters. */
export function anyWindowOpen(
  windows: ReturnType<typeof clockWindows>,
  now: Date,
  /** Each person's own end, so a day owed until midnight is still watched. */
  ends: (Date | null | undefined)[] = []
): boolean {
  if (!windows) return false;
  const t = now.getTime();
  if (t >= windows.start.getTime() && t < windows.inUntil.getTime() + 5 * 60_000) return true;

  // The out side belongs to each person now, so the earliest end opens the
  // window and the latest closes it. The studio's own end is always in the
  // list: somebody the device never saw is still measured against it.
  const times = [windows.end.getTime(), ...ends.flatMap((at) => (at ? [at.getTime()] : []))];
  const from = Math.min(...times) - OUT_WARNING_MINUTES * 60_000;
  const until = Math.max(...times) + (CHASE_MINUTES + 5) * 60_000;
  return t >= from && t < until;
}

/**
 * What is due now. `sent` is what has already gone today, per person. A
 * repeated kind ("in", "out") is due again REPEAT_SECONDS after the last; the
 * one-off kinds once a day.
 */
export function dueClockReminders(input: {
  now: Date;
  windows: ReturnType<typeof clockWindows>;
  people: ClockPerson[];
  sent: Map<string, ClockSent[]>;
}): ClockDue[] {
  const { now, windows, people, sent } = input;
  if (!windows) return [];
  const t = now.getTime();
  const due: ClockDue[] = [];

  for (const person of people) {
    const mine = sent.get(person.id) ?? [];
    const last = (kind: ClockKind) => mine.find((s) => s.kind === kind)?.lastAt ?? null;
    const repeatDue = (kind: ClockKind) => {
      const at = last(kind);
      return !at || (t - at.getTime()) / 1000 >= REPEAT_SECONDS;
    };

    // Clocking in: from the start, until the device sees them or the hour is up.
    if (!person.arrivedAt) {
      if (t >= windows.start.getTime() && t < windows.inUntil.getTime()) {
        if (repeatDue("in")) due.push({ employeeId: person.id, kind: "in" });
      } else if (t >= windows.inUntil.getTime() && t < windows.end.getTime() && last("in") && !last("in-missed")) {
        // Chased for the hour and still nothing: the manager is told, once.
        due.push({ employeeId: person.id, kind: "in-missed" });
      }
      continue; // nobody is asked to clock out of a day the device never saw them start
    }

    if (person.departedAt) continue; // clocked out already, at any hour

    // Their own end, not the studio's.
    const ends = (person.endsAt ?? windows.end).getTime();
    const outSoonFrom = ends - OUT_WARNING_MINUTES * 60_000;
    const outUntil = ends + CHASE_MINUTES * 60_000;

    if (t >= outSoonFrom && t < ends) {
      if (!last("out-soon")) due.push({ employeeId: person.id, kind: "out-soon" });
    } else if (t >= ends && t < outUntil) {
      if (repeatDue("out")) due.push({ employeeId: person.id, kind: "out" });
    } else if (t >= outUntil && last("out") && !last("out-missed")) {
      due.push({ employeeId: person.id, kind: "out-missed" });
    }
  }

  return due;
}
