import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import {
  dueFollowUps,
  markAsked,
  openFollowUpForTask,
  recordAnswer,
  scheduleFollowUps,
} from "@/lib/follow-up-queue";
import { runFollowUps } from "@/lib/notifications/follow-up-events";
import { DEFAULT_WORK_HOURS } from "@/lib/work-hours";
import { dayKeyToDate } from "@/lib/time";

// The queue is the first scheduled work in the platform, so the things worth
// proving are the ones a scheduler gets wrong: that publishing twice asks once,
// that a poller which runs twice sends once, and that somebody who has already
// finished is not chased about it.
//
// A day in the past, so everything written is due immediately.
const DAY = "2026-09-06";
const TZ = "Asia/Amman";
// 20:00 in Amman on that day, after every question on it has come due. The
// tests run as of that evening rather than as of whenever they happen to run:
// a question is only ever asked on its own day.
const ON_THE_DAY = new Date("2026-09-06T17:00:00Z");

let reachable = false;
let employeeId = "";
let entryId = "";
let projectId = "";
let taskId = "";
let sectionId = "";

const slots = [
  { from: "11:00", to: "12:30", keep: true, entryId: "", jobId: null as string | null },
  { from: "13:00", to: "13:30", keep: false, entryId: null as string | null, jobId: null as string | null },
];

before(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    reachable = true;
  } catch {
    return;
  }

  const employee = await prisma.employee.create({
    data: { name: "zfu-Wael", email: "zfu-wael@test.local", active: true },
    select: { id: true },
  });
  employeeId = employee.id;

  const project = await prisma.project.create({
    data: { name: "zfu-Project", token: `zfu-${Date.now()}`, clientName: "zfu" },
    select: { id: true },
  });
  projectId = project.id;

  const section = await prisma.processSection.create({
    data: { name: "zfu-Section", order: 900 },
    select: { id: true },
  });
  sectionId = section.id;

  const task = await prisma.processTask.create({
    data: { name: "zfu-Step", order: 900, sectionId: section.id },
    select: { id: true },
  });
  taskId = task.id;

  const entry = await prisma.projectTaskEntry.create({
    data: { projectId: project.id, taskId: task.id, assigneeId: employee.id, state: "TODO" },
    select: { id: true },
  });
  entryId = entry.id;
  slots[0].entryId = entry.id;
});

after(async () => {
  if (!reachable) return;
  await prisma.scheduledFollowUp.deleteMany({ where: { employeeId } }).catch(() => null);
  await prisma.notification.deleteMany({ where: { employeeId } }).catch(() => null);
  await prisma.projectTaskEntry.deleteMany({ where: { projectId } }).catch(() => null);
  await prisma.processTask.deleteMany({ where: { id: taskId } }).catch(() => null);
  await prisma.processSection.deleteMany({ where: { id: sectionId } }).catch(() => null);
  await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => null);
  await prisma.employee.deleteMany({ where: { id: employeeId } }).catch(() => null);
});

const queue = () =>
  scheduleFollowUps({ employeeId, dayKey: DAY, hours: DEFAULT_WORK_HOURS, timezone: TZ, blocks: slots });

describe("putting a day's questions in the queue", () => {
  it("writes one for the day, and one at each end of every block that is on it", async (t) => {
    if (!reachable) return t.skip("no database");

    await queue();
    const rows = await prisma.scheduledFollowUp.findMany({
      where: { employeeId, day: dayKeyToDate(DAY) },
      orderBy: { dueAt: "asc" },
      select: { kind: true, blockIndex: true, entryId: true },
    });

    // day-start, block-start, block-middle (90 minutes), block-end, day-end.
    assert.deepEqual(
      rows.map((row) => row.kind),
      ["day-start", "block-start", "block-middle", "block-end", "day-end"]
    );
    // Only the ticked block, and it knows which cell it is about.
    assert.deepEqual([...new Set(rows.map((row) => row.blockIndex))], [null, 0]);
    assert.equal(rows.find((row) => row.kind === "block-start")?.entryId, entryId);
  });

  it("asks once however many times the plan is published", async (t) => {
    if (!reachable) return t.skip("no database");

    const before = await prisma.scheduledFollowUp.count({ where: { employeeId } });
    await queue();
    await queue();

    assert.equal(await prisma.scheduledFollowUp.count({ where: { employeeId } }), before);
  });
});

describe("asking what has come due", () => {
  it("sends each question once, and stamps it so it is never sent again", async (t) => {
    if (!reachable) return t.skip("no database");

    const waiting = await dueFollowUps(ON_THE_DAY, { timeZone: TZ });
    const mine = waiting.filter((row) => row.employeeId === employeeId);
    assert.ok(mine.length > 0, "by the evening, every question on the day is due");

    const first = await runFollowUps(ON_THE_DAY, TZ);
    assert.ok(first.due > 0);

    const stillDue = (await dueFollowUps(ON_THE_DAY, { timeZone: TZ })).filter((row) => row.employeeId === employeeId);
    assert.equal(stillDue.length, 0, "nothing should remain unasked");

    // The employee was told, under the question's own key.
    const told = await prisma.notification.count({ where: { employeeId } });
    assert.ok(told > 0, "a notification should have been written");

    // A second run has nothing left to do, and writes nothing new.
    const second = await runFollowUps(ON_THE_DAY, TZ);
    const toldAgain = await prisma.notification.count({ where: { employeeId } });
    assert.equal(second.sent, 0);
    assert.equal(toldAgain, told);
  });

  it("does not chase somebody about work they have already handed in", async (t) => {
    if (!reachable) return t.skip("no database");

    await prisma.projectTaskEntry.update({ where: { id: entryId }, data: { state: "SUBMITTED" } });
    await prisma.scheduledFollowUp.updateMany({
      where: { employeeId, kind: "block-end" },
      data: { askedAt: null },
    });

    const before = await prisma.notification.count({ where: { employeeId } });
    const result = await runFollowUps(ON_THE_DAY, TZ);

    assert.ok(result.skipped > 0, "the finished task should have been skipped");
    assert.equal(await prisma.notification.count({ where: { employeeId } }), before);

    const left = (await dueFollowUps(ON_THE_DAY, { timeZone: TZ })).filter((row) => row.employeeId === employeeId);
    assert.equal(left.length, 0, "a skipped question is still marked asked");
  });

  it("never asks about a day that is already over, and leaves the question unasked", async (t) => {
    if (!reachable) return t.skip("no database");

    // Every question on the day unasked again, looked at from the next morning:
    // what a scheduler that was down overnight would find when it came back.
    await prisma.scheduledFollowUp.updateMany({ where: { employeeId }, data: { askedAt: null } });
    const nextMorning = new Date("2026-09-07T08:00:00Z"); // 11:00 in Amman on the 7th

    const due = (await dueFollowUps(nextMorning, { timeZone: TZ })).filter((row) => row.employeeId === employeeId);
    assert.equal(due.length, 0, "yesterday's questions are not due today");

    const before = await prisma.notification.count({ where: { employeeId } });
    await runFollowUps(nextMorning, TZ);
    assert.equal(await prisma.notification.count({ where: { employeeId } }), before, "nothing is sent about yesterday");

    // Not stamped either: the day board counts an asked, unanswered question as
    // one somebody has not replied to, and nobody received these.
    assert.equal(await prisma.scheduledFollowUp.count({ where: { employeeId, askedAt: { not: null } } }), 0);
  });
});

describe("the question a task is still waiting on", () => {
  it("offers the one that has been asked and not yet answered", async (t) => {
    if (!reachable) return t.skip("no database");

    // Start from a known state rather than from whatever the tests before this
    // one left open: earlier runs deliberately leave a skipped question asked.
    await prisma.scheduledFollowUp.updateMany({
      where: { employeeId, entryId },
      data: { askedAt: null, answeredAt: null, answer: null },
    });

    // Reopen one, as the poller would have left it after sending.
    const row = await prisma.scheduledFollowUp.findFirst({ where: { employeeId, kind: "block-middle" } });
    assert.ok(row);
    await prisma.scheduledFollowUp.update({ where: { id: row.id }, data: { askedAt: new Date() } });

    const open = await openFollowUpForTask(employeeId, entryId);
    assert.equal(open?.id, row.id);
    assert.equal(open?.kind, "block-middle");
  });

  it("offers the most recent one when a block left two open", async (t) => {
    if (!reachable) return t.skip("no database");

    // A block that ran long collects a middle and an end; the end is the one
    // worth putting in front of somebody.
    await prisma.scheduledFollowUp.updateMany({
      where: { employeeId, entryId },
      data: { askedAt: new Date(), answeredAt: null, answer: null },
    });

    const open = await openFollowUpForTask(employeeId, entryId);
    const latest = await prisma.scheduledFollowUp.findFirst({
      where: { employeeId, entryId },
      orderBy: { dueAt: "desc" },
      select: { id: true },
    });

    assert.equal(open?.id, latest?.id);
  });

  it("offers nothing once it has been answered", async (t) => {
    if (!reachable) return t.skip("no database");

    const row = await prisma.scheduledFollowUp.findFirst({
      where: { employeeId, entryId, answeredAt: null, askedAt: { not: null } },
    });
    assert.ok(row);
    await recordAnswer(row.id, "started");

    const open = await openFollowUpForTask(employeeId, entryId);
    assert.notEqual(open?.id, row.id);
  });

  it("offers nothing to somebody else", async (t) => {
    if (!reachable) return t.skip("no database");

    assert.equal(await openFollowUpForTask("somebody-else", entryId), null);
  });

  it("never offers a question whose time has not come", async (t) => {
    if (!reachable) return t.skip("no database");

    // Unasked rows are not something to put in front of anybody.
    await prisma.scheduledFollowUp.updateMany({
      where: { employeeId, entryId },
      data: { askedAt: null, answeredAt: null, answer: null },
    });

    assert.equal(await openFollowUpForTask(employeeId, entryId), null);
  });
});

describe("what the employee said", () => {
  it("keeps the answer, and the note with it", async (t) => {
    if (!reachable) return t.skip("no database");

    const row = await prisma.scheduledFollowUp.findFirst({ where: { employeeId, kind: "block-start" } });
    assert.ok(row);

    await recordAnswer(row.id, "blocked", "  Waiting on the site measurements  ");
    const saved = await prisma.scheduledFollowUp.findUnique({ where: { id: row.id } });

    assert.equal(saved?.answer, "blocked");
    assert.equal(saved?.answerNote, "Waiting on the site measurements");
    assert.ok(saved?.answeredAt);
  });

  it("counts an attempt each time a question goes out", async (t) => {
    if (!reachable) return t.skip("no database");

    const row = await prisma.scheduledFollowUp.findFirst({ where: { employeeId, kind: "day-start" } });
    assert.ok(row);

    const before = row.attempts;
    await markAsked(row.id);
    const after = await prisma.scheduledFollowUp.findUnique({ where: { id: row.id } });

    assert.equal(after?.attempts, before + 1);
  });
});
