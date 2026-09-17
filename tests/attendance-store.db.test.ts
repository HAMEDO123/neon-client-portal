import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { DEVICE, MANUAL, type DayAttendance } from "@/lib/attendance";
import { applyAttendance, mappedByDeviceUser, newestDeviceDay } from "@/lib/attendance-store";
import { dayKeyToDate } from "@/lib/time";

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

async function person(name: string, deviceUserId: string, active: boolean) {
  return prisma.employee.create({
    data: {
      name: `${PREFIX}${name}`,
      email: `${PREFIX}${name.toLowerCase()}@test.local`,
      accessRole: "EMPLOYEE",
      active,
      deviceUserId,
    },
    select: { id: true },
  });
}

/** One day as the device would describe it. */
const day = (deviceUserId: string, delayHours: number, dayKey = DAY): DayAttendance => ({
  deviceUserId,
  dayKey,
  arrivedAt: new Date(`${dayKey}T08:30:00.000Z`),
  lastAt: new Date(`${dayKey}T16:00:00.000Z`),
  punches: 2,
  delayHours,
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

  it("finds the newest day it has written", async (t) => {
    if (!reachable) return t.skip("no database");

    await applyAttendance([day(`${PREFIX}901`, 0.25, "2026-09-20")]);
    const newest = await newestDeviceDay();
    assert.ok(newest, "there is one");
    assert.ok(newest.getTime() >= dayKeyToDate("2026-09-20").getTime());
  });
});
