import { prisma } from "@/lib/db";
import { DEVICE, mayDeviceWrite, type DayAttendance } from "@/lib/attendance";
import { dayKeyToDate } from "@/lib/time";

// Writing what the fingerprint device saw into the table payroll already reads.
// The arithmetic is lib/attendance.ts; talking to the machine is
// lib/attendance-device.ts. This is only the part that touches the database.
//
// Not "use server": every export of one of those is callable over the network,
// and these trust their caller to have checked who is asking.

/** Everybody who has been paired with a number on the device. */
export async function mappedByDeviceUser() {
  const rows = await prisma.employee.findMany({
    // Deliberately **not** filtered by role, and the only query here that is
    // not. Everywhere else in the platform "the team" means staff; attendance
    // means whoever the machine reads, and the manager is paired to a number on
    // it like anybody else. Their row exists for exactly this and is kept out
    // of the team's working surfaces instead.
    where: { deviceUserId: { not: null } },
    select: { id: true, name: true, active: true, deviceUserId: true },
  });

  return new Map(rows.map((row) => [row.deviceUserId as string, row]));
}

export type SyncOutcome = {
  /** Days written for the first time. */
  created: number;
  /** Days the device had already written and has now corrected. */
  updated: number;
  /** Days left alone because the manager had set them by hand. */
  keptManual: number;
  /** Days belonging to somebody who is no longer on the team. */
  skippedInactive: number;
  /** Numbers on the device that no employee is paired with, each once. */
  unmapped: string[];
};

/**
 * Records a run of the device's days.
 *
 * Three refusals, all deliberate:
 *
 * - **A number nobody is paired with is reported, never guessed.** The device's
 *   names and the studio's rarely match — only one of five did the first time
 *   this was run — so matching on a name would sooner or later deduct from the
 *   wrong person's pay and leave nothing to show why.
 * - **Somebody who has left the team is skipped.** They are not being paid, and
 *   a row for them would still be counted as a day of attendance on the payroll
 *   screen.
 * - **A day the manager typed is never overwritten.** They typed it because the
 *   device was wrong, off, or the person was on site; a sync that silently put
 *   its own figure back would undo the correction where it costs money.
 *
 * Written one day at a time rather than in a Promise.all: several writes fired
 * at once is what the local Postgres proxy falls over on, and the whole sync is
 * a background job that nobody is waiting on.
 */
export async function applyAttendance(days: DayAttendance[]): Promise<SyncOutcome> {
  const people = await mappedByDeviceUser();

  const outcome: SyncOutcome = {
    created: 0,
    updated: 0,
    keptManual: 0,
    skippedInactive: 0,
    unmapped: [],
  };

  for (const day of days) {
    const person = people.get(day.deviceUserId);

    if (!person) {
      if (!outcome.unmapped.includes(day.deviceUserId)) outcome.unmapped.push(day.deviceUserId);
      continue;
    }
    if (!person.active) {
      outcome.skippedInactive += 1;
      continue;
    }

    const date = dayKeyToDate(day.dayKey);
    const existing = await prisma.attendanceRecord.findUnique({
      where: { employeeId_day: { employeeId: person.id, day: date } },
      select: { id: true, source: true },
    });

    if (existing && !mayDeviceWrite(existing.source)) {
      outcome.keptManual += 1;
      continue;
    }

    await prisma.attendanceRecord.upsert({
      where: { employeeId_day: { employeeId: person.id, day: date } },
      create: {
        employeeId: person.id,
        day: date,
        delayHours: day.delayHours,
        source: DEVICE,
        note: noteFor(day),
      },
      update: {
        delayHours: day.delayHours,
        source: DEVICE,
        note: noteFor(day),
      },
    });

    if (existing) outcome.updated += 1;
    else outcome.created += 1;
  }

  return outcome;
}

/**
 * What the row says about itself, in the same box the manager types into.
 *
 * The arrival time rather than the lateness: the hours are already in their own
 * column, and what a person reading the payroll screen wants to know about a
 * disputed day is when the finger actually touched the machine.
 */
function noteFor(day: DayAttendance) {
  const time = day.arrivedAt.toISOString().slice(11, 16);
  return `Device · arrived ${time} UTC · ${day.punches} ${day.punches === 1 ? "read" : "reads"}`;
}

/** The newest day the device has already accounted for, so a sync can ask for less. */
export async function newestDeviceDay(): Promise<Date | null> {
  const row = await prisma.attendanceRecord.findFirst({
    where: { source: DEVICE },
    orderBy: { day: "desc" },
    select: { day: true },
  });
  return row?.day ?? null;
}
