import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { performanceFor } from "@/lib/performance-queries";

// The numbers against real rows.
//
// The pure arithmetic is covered in performance.test.ts. What can only be shown
// here is whose work each fact belongs to — and that is exactly where the first
// version of this gatherer was wrong: it counted a cell for the step's standing
// owner even when the manager had handed that cell to somebody else. Every
// assertion about a sample size below is really an assertion about ownership.
//
// Run with: npm run test:db   (needs the local dev database up)

const PREFIX = "zperf-";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const now = new Date();
const since = new Date(now.getTime() - 30 * 24 * HOUR);
const ago = (hours: number) => new Date(now.getTime() - hours * HOUR);

let reachable = false;
let mineId = "";
let otherId = "";
let projectId = "";
const stepIds: string[] = [];
/** The three cells this employee owns, in order. */
const owned: string[] = [];
/** A cell of a step they own, handed to somebody else. */
let handedOver = "";
/** A cell with nothing else happening on it, for the blocked measurement. */
let quiet = "";

async function cleanup() {
  await prisma.taskStateChange.deleteMany({ where: { entry: { task: { name: { startsWith: PREFIX } } } } });
  await prisma.scheduledFollowUp.deleteMany({ where: { employee: { name: { startsWith: PREFIX } } } });
  await prisma.taskSubmission.deleteMany({ where: { employee: { name: { startsWith: PREFIX } } } });
  await prisma.projectTaskEntry.deleteMany({ where: { task: { name: { startsWith: PREFIX } } } });
  await prisma.processTask.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.employee.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.project.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

before(async () => {
  try {
    await prisma.$queryRaw`select 1`;
    reachable = true;
  } catch {
    reachable = false;
    return;
  }

  await cleanup();

  const mine = await prisma.employee.create({
    data: { name: `${PREFIX}Wael`, email: `${PREFIX}wael@test.local`, active: true },
  });
  mineId = mine.id;

  const other = await prisma.employee.create({
    data: { name: `${PREFIX}Other`, email: `${PREFIX}other@test.local`, active: true },
  });
  otherId = other.id;

  const project = await prisma.project.create({
    data: { name: `${PREFIX}Project`, token: `${PREFIX}${Date.now()}`, clientName: "Test Client" },
  });
  projectId = project.id;

  // Five steps, every one of them standing in this employee's name.
  for (const [index, suffix] of ["Plan", "Model", "Render", "Survey", "Quiet"].entries()) {
    const step = await prisma.processTask.create({
      data: { name: `${PREFIX}${suffix}`, employeeId: mineId, order: 900 + index },
    });
    stepIds.push(step.id);
  }

  // Three cells left with the step owner, each with a deadline and an estimate
  // of one hour: two landed on time, the third a day late.
  // All three were accepted 48 hours ago, so a deadline later than that was met
  // and an earlier one was missed: two on time, and one a day and a half late.
  const deadlines = [ago(40), ago(40), ago(80)];
  const startedBefore = [1, 1.1, 10]; // hours of real work, against a 1-hour estimate
  for (const [index, stepId] of stepIds.slice(0, 3).entries()) {
    const entry = await prisma.projectTaskEntry.create({
      data: {
        projectId,
        taskId: stepId,
        state: "DONE",
        dueAt: deadlines[index],
        estimateHours: 1,
        completedAt: ago(48),
      },
    });
    owned.push(entry.id);

    await prisma.taskStateChange.create({
      data: {
        entryId: entry.id,
        fromState: "TODO",
        toState: "IN_PROGRESS",
        actorType: "employee",
        actorEmployeeId: mineId,
        createdAt: new Date(ago(48).getTime() - startedBefore[index] * HOUR),
      },
    });
    await prisma.taskStateChange.create({
      data: {
        entryId: entry.id,
        fromState: "SUBMITTED",
        toState: "DONE",
        actorType: "manager",
        createdAt: ago(48),
      },
    });
  }

  // The one that matters: a step in this employee's name, on a cell the manager
  // gave to somebody else. Finished on time, and none of it theirs.
  const given = await prisma.projectTaskEntry.create({
    data: {
      projectId,
      taskId: stepIds[3],
      state: "DONE",
      assigneeId: otherId,
      dueAt: ago(50),
      estimateHours: 1,
      completedAt: ago(48),
    },
  });
  handedOver = given.id;
  await prisma.taskStateChange.create({
    data: {
      entryId: given.id,
      fromState: "SUBMITTED",
      toState: "DONE",
      actorType: "manager",
      createdAt: ago(48),
    },
  });

  // A cell with one thing happening on it, so the waiting can be measured to
  // the minute.
  const still = await prisma.projectTaskEntry.create({
    data: { projectId, taskId: stepIds[4], state: "IN_PROGRESS" },
  });
  quiet = still.id;
});

after(async () => {
  if (reachable) await cleanup();
  await prisma.$disconnect();
});

describe("whose work it is", () => {
  it("does not count a cell the manager handed to somebody else", async (t) => {
    if (!reachable) return t.skip("no database");

    const result = await performanceFor(mineId, since);

    // Four cells finished, all of them steps standing in this person's name.
    // Three are theirs; the fourth was handed over, and counting it would be
    // the whole bug this test exists for.
    assert.equal(result.onTime.sample, 3);
    assert.equal(result.onTime.value, 67);

    // And it is counted for the person it was actually given to — who has only
    // that one, so no number is reported at all.
    const theirs = await performanceFor(otherId, since);
    assert.equal(theirs.onTime.sample, 1);
    assert.equal(theirs.onTime.value, null);
    assert.match(theirs.onTime.why ?? "", /only 1/i);

    assert.ok(handedOver);
  });

  it("measures how long the work took, from the first time it was started", async (t) => {
    if (!reachable) return t.skip("no database");

    const result = await performanceFor(mineId, since);

    // One hour estimated each; 1, 1.1 and 10 hours spent. The median is what is
    // reported, so the afternoon that went badly does not define the person.
    assert.equal(result.estimates.sample, 3);
    assert.equal(result.estimates.value, 1.1);
  });
});

describe("what the review made of it", () => {
  it("counts a piece of work once, however many times it was sent", async (t) => {
    if (!reachable) return t.skip("no database");

    // First time for two of them; the third came back once before it was taken.
    await prisma.taskSubmission.create({
      data: { entryId: owned[0], employeeId: mineId, imageUrl: "/uploads/a.jpg", status: "APPROVED", createdAt: ago(60) },
    });
    await prisma.taskSubmission.create({
      data: { entryId: owned[1], employeeId: mineId, imageUrl: "/uploads/b.jpg", status: "APPROVED", createdAt: ago(59) },
    });
    await prisma.taskSubmission.create({
      data: { entryId: owned[2], employeeId: mineId, imageUrl: "/uploads/c1.jpg", status: "REJECTED", createdAt: ago(58) },
    });
    await prisma.taskSubmission.create({
      data: { entryId: owned[2], employeeId: mineId, imageUrl: "/uploads/c2.jpg", status: "APPROVED", createdAt: ago(57) },
    });
    // Still being argued over: no verdict, so it takes no part.
    await prisma.taskSubmission.create({
      data: { entryId: quiet, employeeId: mineId, imageUrl: "/uploads/d.jpg", status: "REJECTED", createdAt: ago(56) },
    });

    const result = await performanceFor(mineId, since);

    assert.equal(result.acceptedFirstTime.sample, 3);
    assert.equal(result.acceptedFirstTime.value, 67);
    assert.equal(result.rework.value, Math.round((1 / 3) * 100) / 100);
  });
});

describe("time lost waiting on somebody else", () => {
  it("runs from the answer to the next thing that happened", async (t) => {
    if (!reachable) return t.skip("no database");

    const saidSo = ago(6);
    await prisma.scheduledFollowUp.create({
      data: {
        employeeId: mineId,
        day: new Date(`${saidSo.toISOString().slice(0, 10)}T00:00:00.000Z`),
        kind: "block-middle",
        entryId: quiet,
        dueAt: saidSo,
        askedAt: saidSo,
        answer: "blocked",
        answeredAt: saidSo,
        dedupeKey: `${PREFIX}blocked-1`,
      },
    });

    // Nothing has moved yet, so the waiting is still running: about six hours.
    const waiting = await performanceFor(mineId, since);
    assert.equal(waiting.blockedWaiting.sample, 1);
    assert.ok(
      Math.abs((waiting.blockedWaiting.value ?? 0) - 6 * 60) <= 2,
      `expected about 360 minutes, got ${waiting.blockedWaiting.value}`
    );

    // Then somebody unsticks it, and the waiting stops at that moment.
    await prisma.taskStateChange.create({
      data: {
        entryId: quiet,
        fromState: "TODO",
        toState: "IN_PROGRESS",
        actorType: "employee",
        actorEmployeeId: mineId,
        createdAt: new Date(saidSo.getTime() + 90 * MINUTE),
      },
    });

    const freed = await performanceFor(mineId, since);
    assert.equal(freed.blockedWaiting.value, 90);
  });
});
