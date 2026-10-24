import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { ARRIVAL, DEVICE, MANUAL, type DayAttendance } from "@/lib/attendance";
import { applyAttendance, mappedByDeviceUser, newestDeviceDay } from "@/lib/attendance-store";
import { dayKeyToDate } from "@/lib/time";
import { DEFAULT_WORK_HOURS } from "@/lib/work-hours";
import { databaseTarget } from "./db-target";

// Refuses the studio's live database outright — see tests/db-target.ts.
//
// At the top of the file on purpose: inside `before`'s try/catch this throw was
// swallowed by the "is there a database" handler and came back as 12 skipped
// tests, which reads as the development database being down. A refusal that
// looks like an ordinary skip is worse than no refusal at all.
const target = databaseTarget(process.env.DATABASE_URL);
if (!target.safe) throw new Error(target.why);


// What the device is allowed to write, against a real database.
//
// This is the module between a fingerprint and somebody's pay, so the three
// refusals are the point of the file: a number nobody is paired with is never
// guessed at, somebody who has left is never recorded, and a figure the manager
// typed is never overwritten.
//
// Run with: npm run test:db   (needs the local dev database up)

const PREFIX = "ztest-att-";
const DAY = "2026-09-17";

let reachable = false;
let amal: { id: string };
let basel: { id: string };

async function cleanup() {
  const people = await prisma.employee.findMany({
    where: { name: { startsWith: PREFIX } },
    select: { id: true },
  });
  if (people.length > 0) {
    await prisma.attendanceRecord.deleteMany({ where: { employeeId: { in: people.map((p) => p.id) } } });
  }
  await prisma.employee.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

async function person(name: string, deviceUserId: string, active: boolean, openHours = false) {
  return prisma.employee.create({
    data: {
      name: `${PREFIX}${name}`,
      email: `${PREFIX}${name.toLowerCase()}@test.local`,
      accessRole: "EMPLOYEE",
      active,
      deviceUserId,
      openHours,
    },
    select: { id: true },
  });
}

/** One day as the device would describe it: in at 11:30, out at 19:00. */
const day = (
  deviceUserId: string,
  delayHours: number,
  dayKey = DAY,
  earlyHours = 0
): DayAttendance => ({
  deviceUserId,
  dayKey,
  arrivedAt: new Date(`${dayKey}T08:30:00.000Z`),
  arrivedLocal: "11:30 AM",
  lastAt: new Date(`${dayKey}T16:00:00.000Z`),
  lastLocal: "7:00 PM",
  earlyAtLast: earlyHours,
  departedAt: new Date(`${dayKey}T16:00:00.000Z`),
  departedLocal: "7:00 PM",
  punches: 2,
  delayHours,
  earlyHours,
});

before(async () => {
  try {
    await prisma.$queryRaw`select 1`;
    reachable = true;
  } catch {
    reachable = false;
    return;
  }

  await cleanup();

  // One at a time: fixtures built concurrently are what the local database falls over on.
  amal = await person("Amal", `${PREFIX}901`, true);
  basel = await person("Basel", `${PREFIX}902`, false);
});

after(async () => {
  if (reachable) await cleanup();
  await prisma.$disconnect();
});

describe("what a sync writes", () => {
  it("records a day for somebody who is paired and still here", async (t) => {
    if (!reachable) return t.skip("no database");

    const outcome = await applyAttendance([day(`${PREFIX}901`, 0.5)]);
    assert.equal(outcome.created, 1);
    assert.equal(outcome.updated, 0);

    const row = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { employeeId_day: { employeeId: amal.id, day: dayKeyToDate(DAY) } },
      select: { delayHours: true, source: true, note: true },
    });
    assert.equal(row.delayHours, 0.5);
    assert.equal(row.source, DEVICE);
    assert.match(row.note ?? "", /^Device ·/, "the row says where it came from");
  });

  it("runs again over the same day without doubling it", async (t) => {
    if (!reachable) return t.skip("no database");

    // The device hands over its whole log every time, so a sync must be safe to
    // repeat — it lands on the same (employee, day) row with the same numbers.
    const outcome = await applyAttendance([day(`${PREFIX}901`, 0.75)]);
    assert.equal(outcome.created, 0);
    assert.equal(outcome.updated, 1);

    const rows = await prisma.attendanceRecord.count({ where: { employeeId: amal.id } });
    assert.equal(rows, 1, "still one row for that day");

    const row = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { employeeId_day: { employeeId: amal.id, day: dayKeyToDate(DAY) } },
      select: { delayHours: true },
    });
    assert.equal(row.delayHours, 0.75, "and it corrects itself");
  });

  it("never writes over a figure the manager typed", async (t) => {
    if (!reachable) return t.skip("no database");

    await prisma.attendanceRecord.update({
      where: { employeeId_day: { employeeId: amal.id, day: dayKeyToDate(DAY) } },
      data: { delayHours: 0, source: MANUAL, note: "Was on site" },
    });

    const outcome = await applyAttendance([day(`${PREFIX}901`, 3)]);
    assert.equal(outcome.keptManual, 1);
    assert.equal(outcome.updated, 0);

    const row = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { employeeId_day: { employeeId: amal.id, day: dayKeyToDate(DAY) } },
      select: { delayHours: true, source: true, note: true },
    });
    assert.equal(row.delayHours, 0, "the correction stands");
    assert.equal(row.source, MANUAL);
    assert.equal(row.note, "Was on site");
  });

  it("fills a clock-out the manager never set, and leaves everything else alone", async (t) => {
    if (!reachable) return t.skip("no database");

    // The shape four evenings in a row produced: a step-out was typed, which
    // turned the row MANUAL, and the clock-out had not happened yet. Nobody
    // had said anything about when this person went home.
    const date = dayKeyToDate("2026-09-22");
    await prisma.attendanceRecord.create({
      data: {
        employeeId: amal.id,
        day: date,
        delayHours: 0,
        earlyHours: 0,
        awayHours: 4,
        breaks: [{ out: "11:10", back: "14:45" }],
        arrivedAt: new Date("2026-09-22T08:30:00.000Z"),
        source: MANUAL,
        note: "Device · arrived 11:30 AM · stepped out",
      },
    });

    const outcome = await applyAttendance([day(`${PREFIX}901`, 3, "2026-09-22", 2)]);
    assert.equal(outcome.departuresFilled, 1);
    assert.equal(outcome.keptManual, 0, "the day was not refused outright");

    const row = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { employeeId_day: { employeeId: amal.id, day: date } },
    });
    assert.equal(row.departedAt?.toISOString(), "2026-09-22T16:00:00.000Z", "the device supplied the clock-out");
    assert.equal(row.source, MANUAL, "still the manager's row");
    assert.equal(row.delayHours, 0, "the correction stands");
    // The device saw two hours left early; a manual row never has its money
    // recomputed, which is the whole point of MANUAL.
    assert.equal(row.earlyHours, 0, "no hours were charged by the fill");
    assert.equal(row.awayHours, 4, "the step-out is untouched");
    assert.equal(row.note, "Device · arrived 11:30 AM · stepped out · device: left 7:00 PM");
  });

  it("charges nothing to somebody who works open hours", async (t) => {
    if (!reachable) return t.skip("no database");

    // No start to be late for and no end to leave early from: the day records
    // the times and costs nothing. Arriving at 4 PM and working till midnight
    // is a full day for somebody on open hours, and the studio's clock has
    // nothing to say about it.
    const open = await person("Open", `${PREFIX}903`, true, true);
    const context = { hours: { ...DEFAULT_WORK_HOURS, graceMinutes: 5 }, timeZone: "Asia/Amman" };
    const dayKey = "2026-09-28";

    await applyAttendance(
      [
        {
          ...day(`${PREFIX}903`, 6, dayKey, 2),
          arrivedAt: new Date("2026-09-28T13:00:00.000Z"), // 4:00 PM in Amman
          arrivedLocal: "4:00 PM",
          lastAt: new Date("2026-09-28T21:00:00.000Z"),
          departedAt: new Date("2026-09-28T21:00:00.000Z"), // midnight
          departedLocal: "12:00 AM",
        },
      ],
      context
    );

    const row = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { employeeId_day: { employeeId: open.id, day: dayKeyToDate(dayKey) } },
    });
    assert.equal(row.delayHours, 0, "six hours late by the clock, and not late at all");
    assert.equal(row.earlyHours, 0);
    assert.equal(row.shortHours, 0, "nothing is charged");
    // The times are still the record of the day — they are what it is paid on.
    assert.equal(row.arrivedAt?.toISOString(), "2026-09-28T13:00:00.000Z");
    assert.equal(row.departedAt?.toISOString(), "2026-09-28T21:00:00.000Z");
  });

  it("charges a day by what it fell short of the end that person owed", async (t) => {
    if (!reachable) return t.skip("no database");

    // The studio's day is 11:00 to 19:00 with five minutes' allowance, so
    // arriving at 2 PM owes until 21:55 rather than 19:00.
    const context = { hours: { ...DEFAULT_WORK_HOURS, graceMinutes: 5 }, timeZone: "Asia/Amman" };
    const dayKey = "2026-09-24";
    const date = dayKeyToDate(dayKey);
    const late = {
      ...day(`${PREFIX}901`, 3, dayKey, 0),
      arrivedAt: new Date("2026-09-24T11:00:00.000Z"), // 2:00 PM in Amman
      arrivedLocal: "2:00 PM",
    };

    // Left at 7 PM, when the studio's day ends but theirs did not.
    await applyAttendance(
      [{ ...late, lastAt: new Date("2026-09-24T16:00:00.000Z"), departedAt: new Date("2026-09-24T16:00:00.000Z"), departedLocal: "7:00 PM" }],
      context
    );
    const short = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { employeeId_day: { employeeId: amal.id, day: date } },
    });
    assert.equal(short.shortHours, 3, "owed until 21:55 and left at 19:00");
    assert.equal(short.delayHours, 3, "still recorded as having been late");

    // The same day, stayed to the end of it.
    await applyAttendance(
      [{ ...late, lastAt: new Date("2026-09-24T19:00:00.000Z"), departedAt: new Date("2026-09-24T19:00:00.000Z"), departedLocal: "10:00 PM" }],
      context
    );
    const made = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { employeeId_day: { employeeId: amal.id, day: date } },
    });
    assert.equal(made.shortHours, 0, "three hours late, three hours made up, nothing owed");
    assert.equal(made.delayHours, 3, "the lateness is still what happened");
  });

  it("reports when each person's day ends, so they can be told", async (t) => {
    if (!reachable) return t.skip("no database");

    const context = { hours: { ...DEFAULT_WORK_HOURS, graceMinutes: 5 }, timeZone: "Asia/Amman" };
    const outcome = await applyAttendance(
      [
        {
          ...day(`${PREFIX}901`, 3, "2026-09-25", 0),
          arrivedAt: new Date("2026-09-25T11:00:00.000Z"), // 2:00 PM in Amman
          arrivedLocal: "2:00 PM",
        },
      ],
      context
    );

    const ends = outcome.dayEnds.find((row) => row.dayKey === "2026-09-25");
    // 19:00 pushed back by the 2:55 they were late: 21:55, as minutes.
    assert.equal(ends?.endsAtMinutes, 21 * 60 + 55);
    assert.equal(ends?.employeeId, amal.id);
  });

  it("never replaces a clock-out the manager did set", async (t) => {
    if (!reachable) return t.skip("no database");

    const date = dayKeyToDate("2026-09-23");
    await prisma.attendanceRecord.create({
      data: {
        employeeId: amal.id,
        day: date,
        delayHours: 0,
        earlyHours: 0,
        arrivedAt: new Date("2026-09-23T08:30:00.000Z"),
        departedAt: new Date("2026-09-23T15:00:00.000Z"),
        source: MANUAL,
        note: "Left for a site visit",
      },
    });

    const outcome = await applyAttendance([day(`${PREFIX}901`, 3, "2026-09-23", 2)]);
    assert.equal(outcome.keptManual, 1, "a departure that was set is still refused");
    assert.equal(outcome.departuresFilled, 0);

    const row = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { employeeId_day: { employeeId: amal.id, day: date } },
    });
    assert.equal(row.departedAt?.toISOString(), "2026-09-23T15:00:00.000Z", "the manager's time stands");
    assert.equal(row.note, "Left for a site visit");
  });

  it("does not record somebody who has left the team", async (t) => {
    if (!reachable) return t.skip("no database");

    const outcome = await applyAttendance([day(`${PREFIX}902`, 2)]);
    assert.equal(outcome.skippedInactive, 1);
    assert.equal(outcome.created, 0);
    assert.equal(await prisma.attendanceRecord.count({ where: { employeeId: basel.id } }), 0);
  });

  it("reports a number nobody is paired with, and writes nothing for it", async (t) => {
    if (!reachable) return t.skip("no database");

    // Guessing by name is what this refusal exists to prevent: it would sooner
    // or later deduct from the wrong person and leave no trace of why.
    const outcome = await applyAttendance([day("ztest-att-999", 1), day("ztest-att-999", 1, "2026-09-16")]);
    assert.deepEqual(outcome.unmapped, ["ztest-att-999"], "named once, however many days it has");
    assert.equal(outcome.created, 0);
  });
});

describe("what the sync knows about itself", () => {
  it("lists only people who have been paired", async (t) => {
    if (!reachable) return t.skip("no database");

    const mapped = await mappedByDeviceUser();
    assert.equal(mapped.get(`${PREFIX}901`)?.id, amal.id);
    assert.equal(mapped.has("ztest-att-999"), false);
  });

  // Came in on time, forgot to clock in: the arrival is the manager's, the
  // clock-out is still the device's.
  it("keeps an arrival the manager set and records the clock-out beside it", async (t) => {
    if (!reachable) return t.skip("no database");

    const date = dayKeyToDate("2026-09-21");
    await prisma.attendanceRecord.create({
      data: {
        employeeId: amal.id,
        day: date,
        delayHours: 0,
        earlyHours: 0,
        arrivedAt: new Date("2026-09-21T08:00:00.000Z"),
        source: ARRIVAL,
        note: "Arrived on time — forgot to clock in",
      },
    });

    // Remembered at 1:37 PM: one read, which must not be taken as leaving.
    await applyAttendance([
      {
        ...day(`${PREFIX}901`, 3, "2026-09-21", 0),
        arrivedAt: new Date("2026-09-21T10:37:00.000Z"),
        lastAt: new Date("2026-09-21T10:37:00.000Z"),
        lastLocal: "1:37 PM",
        earlyAtLast: 6,
        departedAt: null,
        punches: 1,
      },
    ]);
    const midday = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { employeeId_day: { employeeId: amal.id, day: date } },
    });
    assert.equal(midday.departedAt, null, "the forgotten clock-in is not a departure");
    assert.equal(midday.earlyHours, 0);
    assert.equal(midday.delayHours, 0);

    // Then the clock-out: a second read, which is.
    const outcome = await applyAttendance([
      { ...day(`${PREFIX}901`, 3, "2026-09-21", 0), arrivedAt: new Date("2026-09-21T10:37:00.000Z"), punches: 2 },
    ]);
    assert.equal(outcome.updated, 1);

    const row = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { employeeId_day: { employeeId: amal.id, day: date } },
    });
    assert.equal(row.source, ARRIVAL, "still the manager's");
    assert.equal(row.delayHours, 0, "not late");
    assert.equal(row.arrivedAt?.toISOString(), "2026-09-21T08:00:00.000Z", "arrived when the manager said");
    assert.equal(row.departedAt?.toISOString(), "2026-09-21T16:00:00.000Z", "left when the device saw");
    assert.equal(row.note, "Arrived on time — forgot to clock in · device: left 7:00 PM");

    // Again: the same note, not a longer one.
    await applyAttendance([{ ...day(`${PREFIX}901`, 3, "2026-09-21", 0), punches: 2 }]);
    const again = await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: row.id }, select: { note: true } });
    assert.equal(again.note, row.note);
  });

  it("finds the newest day it has written", async (t) => {
    if (!reachable) return t.skip("no database");

    await applyAttendance([day(`${PREFIX}901`, 0.25, "2026-09-20")]);
    const newest = await newestDeviceDay();
    assert.ok(newest, "there is one");
    assert.ok(newest.getTime() >= dayKeyToDate("2026-09-20").getTime());
  });
});
