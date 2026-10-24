import { prisma } from "@/lib/db";
import {
  ARRIVAL,
  DEVICE,
  dayCharge,
  departureAfter,
  mayDeviceWrite,
  type DayAttendance,
} from "@/lib/attendance";
import { awayMinutesOf, storedBreaks } from "@/lib/attendance-breaks";
import { dayKeyToDate } from "@/lib/time";
import type { WorkHours } from "@/lib/work-hours";

/**
 * The working day a sync writes against.
 *
 * Optional only so a caller with nothing but a list of days still works; every
 * real sync passes it. Without it the charge on a row is left exactly as it
 * was, because working one out means knowing when the studio's day ends and
 * which timezone that is in.
 */
export type WorkContext = { hours: WorkHours; timeZone: string };

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
  /**
   * Days the manager had corrected that were still missing their clock-out,
   * and the device has now supplied it. Counted apart from `updated` because
   * only that one field was written — everything the manager set stands.
   */
  departuresFilled: number;
  /** Days belonging to somebody who is no longer on the team. */
  skippedInactive: number;
  /** Numbers on the device that no employee is paired with, each once. */
  unmapped: string[];
  /**
   * When each person's day ends, for the ones the device has seen arrive.
   *
   * Reported rather than acted on here: this file writes rows, and deciding
   * whether somebody should be told is the sync's business. The end moves when
   * a step-out is typed, so the same day can appear with a different time and
   * is meant to.
   */
  dayEnds: { employeeId: string; dayKey: string; endsAtMinutes: number }[];
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
export async function applyAttendance(days: DayAttendance[], context?: WorkContext): Promise<SyncOutcome> {
  const people = await mappedByDeviceUser();

  const outcome: SyncOutcome = {
    created: 0,
    updated: 0,
    keptManual: 0,
    departuresFilled: 0,
    dayEnds: [],
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
      select: { id: true, source: true, arrivedAt: true, departedAt: true, breaks: true, note: true },
    });

    // Step-outs already on the row push the end of this person's day back, so
    // they are part of what the day costs rather than a charge of their own.
    const awayMinutes = awayMinutesOf(storedBreaks(existing?.breaks));
    /**
     * What the day costs once written, and when it ends — nothing to say
     * without a working day to measure against.
     *
     * The end is collected on the way past because this is the only place that
     * has the arrival, the step-outs and the studio's day in one hand.
     */
    const charge = (arrivedAt: Date | null, departedAt: Date | null) => {
      if (!context) return {};
      const { shortHours, endsAtMinutes } = dayCharge({
        ...context,
        dayKey: day.dayKey,
        arrivedAt,
        departedAt,
        awayMinutes,
      });
      if (endsAtMinutes != null) {
        outcome.dayEnds.push({ employeeId: person.id, dayKey: day.dayKey, endsAtMinutes });
      }
      return { shortHours };
    };

    // The manager set the arrival; the device still says when they left —
    // and nothing else. The arrival and its lateness stay exactly as set.
    if (existing?.source === ARRIVAL && existing.arrivedAt) {
      const left = departureAfter(existing.arrivedAt, day);
      // The manager's own words kept, the device's part rewritten each sync.
      const head = (existing.note ?? "Arrival set by the manager").split(" · device: ")[0];
      await prisma.attendanceRecord.update({
        where: { id: existing.id },
        data: {
          departedAt: left.departedAt,
          earlyHours: left.earlyHours,
          ...charge(existing.arrivedAt, left.departedAt),
          note: `${head} · device: ${left.departedLocal ? `left ${left.departedLocal}` : "no clock-out yet"}`.slice(0, 300),
        },
      });
      outcome.updated += 1;
      continue;
    }

    // A correction owns the figures, not the rest of the day.
    //
    // Typing a step-out at noon, or fixing an arrival, turns the row MANUAL —
    // and from that moment the device was locked out of it entirely, including
    // the clock-out that had not happened yet. Nobody had said anything about
    // when that person went home; the field was simply empty. So on four
    // evenings in a row the tap was made, refused, and typed in by hand.
    //
    // An empty departure may therefore be filled by the device, and nothing
    // else may. A departure the manager DID set is still never touched, and
    // the hours are never recomputed: on a manual row the money stays theirs,
    // which is the whole point of MANUAL and is why this writes no earlyHours.
    //
    // It needs an arrival to measure against — MIN_SHIFT_MINUTES is what stops
    // a second scan on the way in from being read as leaving — so a typed row
    // carrying hours and no times is left exactly as it was.
    if (existing && !mayDeviceWrite(existing.source) && !existing.departedAt && existing.arrivedAt) {
      const left = departureAfter(existing.arrivedAt, day);
      if (left.departedAt) {
        const head = (existing.note ?? "Set by the manager").split(" · device: ")[0];
        await prisma.attendanceRecord.update({
          where: { id: existing.id },
          data: {
            departedAt: left.departedAt,
            // The clock-out is what decides whether the day fell short, and
            // this is the moment it becomes known. The hours the manager typed
            // still stand; the day is measured against the end they owed.
            ...charge(existing.arrivedAt, left.departedAt),
            note: `${head} · device: left ${left.departedLocal}`.slice(0, 300),
          },
        });
        outcome.departuresFilled += 1;
        continue;
      }
    }

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
        arrivedAt: day.arrivedAt,
        departedAt: day.departedAt,
        earlyHours: day.earlyHours,
        ...charge(day.arrivedAt, day.departedAt),
        source: DEVICE,
        note: noteFor(day),
      },
      update: {
        delayHours: day.delayHours,
        arrivedAt: day.arrivedAt,
        departedAt: day.departedAt,
        earlyHours: day.earlyHours,
        ...charge(day.arrivedAt, day.departedAt),
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
  // The studio's own clock, never UTC. This line is read by a person deciding
  // whether a deduction is fair, and "arrived 15:37" for somebody the machine
  // saw at 18:37 is not a detail — it is the wrong answer to the only question
  // they are asking.
  //
  // A day with no clock-out says so in as many words. It is the one thing a
  // manager cannot work out from the numbers — nothing was deducted, and the
  // reason is that nobody knows, not that the day was complete.
  const left = day.departedLocal ? `left ${day.departedLocal}` : "no clock-out";
  return `Device · arrived ${day.arrivedLocal} · ${left} · ${day.punches} ${day.punches === 1 ? "read" : "reads"}`;
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
