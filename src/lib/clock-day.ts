import { prisma } from "@/lib/db";
import { awayMinutesOf, storedBreaks, type Break } from "@/lib/attendance-breaks";
import { countedHours } from "@/lib/attendance";
import { endForPerson } from "@/lib/clock-reminders";
import { dayKeyToDate, instantAt } from "@/lib/time";
import { hoursOn, isWorkingDay, minutesOf, type WorkHours } from "@/lib/work-hours";

// What one person's own day looks like today, for their home screen.
//
// The studio's day is eight hours however it is worked, so the end of it is no
// longer a fact about the studio — it is a fact about the person, and they are
// the one who cannot work it out. It moves with how late they were and with
// every step-out the manager typed for them after they arrived.
//
// So this exists to answer three questions in one glance: has the device seen
// me, when do I have to be gone by, and is anything being taken off today.

export type ClockDay = {
  /** A day the studio works at all. Nothing is shown on the others. */
  working: boolean;
  /** When the studio's day starts, as a person reads it. */
  startsAt: Date | null;
  /** When it ends for everybody else — what the personal end is measured against. */
  usualEnd: Date | null;
  arrivedAt: Date | null;
  departedAt: Date | null;
  /** When THIS person has to be gone by. Null until the device has seen them. */
  endsAt: Date | null;
  /** True when their end is later than the studio's, which is the thing worth saying. */
  moved: boolean;
  lateMinutes: number;
  awayMinutes: number;
  breaks: Break[];
  /** What the day has cost so far — nothing until they have clocked out. */
  shortHours: number;
  /**
   * Works whatever hours they work: no start to be late for and no end to
   * leave early from, so there is no clock-out time to show them at all.
   */
  openHours: boolean;
  /** Hours actually present, less any step-out. Null until they clock out. */
  workedHours: number | null;
  /** What those hours count for on an hourly day: up to a day, never beyond. */
  countsAs: number | null;
};

/** How long, said the way somebody says it out loud: "2h 55m", "40m". */
export function spell(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export async function myClockDay(
  employeeId: string,
  dayKey: string,
  hours: WorkHours,
  timeZone: string
): Promise<ClockDay> {
  const today = hoursOn(hours, dayKey);
  const empty: ClockDay = {
    working: isWorkingDay(hours, dayKey),
    startsAt: instantAt(dayKey, today.start, timeZone),
    usualEnd: instantAt(dayKey, today.end, timeZone),
    arrivedAt: null,
    departedAt: null,
    endsAt: null,
    moved: false,
    lateMinutes: 0,
    awayMinutes: 0,
    breaks: [],
    shortHours: 0,
    openHours: false,
    workedHours: null,
    countsAs: null,
  };
  if (!empty.working) return empty;

  // One after the other, as everything else on this page reads.
  const person = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { openHours: true },
  });
  const openHours = person?.openHours === true;

  const row = await prisma.attendanceRecord.findUnique({
    where: { employeeId_day: { employeeId, day: dayKeyToDate(dayKey) } },
    select: { arrivedAt: true, departedAt: true, breaks: true, shortHours: true },
  });
  if (!row?.arrivedAt) return empty;

  const breaks = storedBreaks(row.breaks);
  const awayMinutes = awayMinutesOf(breaks);
  // No end for somebody on open hours: there is nothing they are owed until,
  // and a deadline drawn from a start they do not work to is a wrong one.
  const endsAt = openHours ? null : endForPerson(hours, dayKey, timeZone, row.arrivedAt, awayMinutes);

  const workedHours =
    row.departedAt && row.arrivedAt
      ? Math.round(((row.departedAt.getTime() - row.arrivedAt.getTime()) / 3_600_000 - awayMinutes / 60) * 100) / 100
      : null;

  // The lateness as it is actually charged — the allowance comes off first, so
  // arriving at 11:04 is not "4 minutes late" to anybody who matters.
  const start = minutesOf(today.start);
  const arrived = empty.startsAt
    ? Math.round((row.arrivedAt.getTime() - empty.startsAt.getTime()) / 60_000) + (start ?? 0)
    : null;
  const grace = Math.max(0, hours.graceMinutes ?? 0);
  const lateMinutes = arrived != null && start != null ? Math.max(0, arrived - start - grace) : 0;

  return {
    ...empty,
    openHours,
    arrivedAt: row.arrivedAt,
    departedAt: row.departedAt,
    endsAt,
    moved: Boolean(endsAt && empty.usualEnd && endsAt.getTime() > empty.usualEnd.getTime()),
    // Not late when there is no start to be late for.
    lateMinutes: openHours ? 0 : lateMinutes,
    awayMinutes,
    breaks,
    shortHours: row.shortHours,
    workedHours,
    countsAs:
      workedHours != null && openHours ? Math.round(countedHours(workedHours, hours) * 100) / 100 : null,
  };
}
