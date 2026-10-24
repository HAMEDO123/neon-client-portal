import { prisma } from "@/lib/db";
import { awayMinutesOf, storedBreaks, type Break } from "@/lib/attendance-breaks";
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
  };
  if (!empty.working) return empty;

  const row = await prisma.attendanceRecord.findUnique({
    where: { employeeId_day: { employeeId, day: dayKeyToDate(dayKey) } },
    select: { arrivedAt: true, departedAt: true, breaks: true, shortHours: true },
  });
  if (!row?.arrivedAt) return empty;

  const breaks = storedBreaks(row.breaks);
  const awayMinutes = awayMinutesOf(breaks);
  const endsAt = endForPerson(hours, dayKey, timeZone, row.arrivedAt, awayMinutes);

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
    arrivedAt: row.arrivedAt,
    departedAt: row.departedAt,
    endsAt,
    moved: Boolean(endsAt && empty.usualEnd && endsAt.getTime() > empty.usualEnd.getTime()),
    lateMinutes,
    awayMinutes,
    breaks,
    shortHours: row.shortHours,
  };
}
