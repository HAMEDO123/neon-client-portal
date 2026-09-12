import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { changesFor, firstStartedAt, recordStateChange } from "@/lib/task-state-log";

// Every action that writes a state now calls recordStateChange, so this is the
// one place the record can be wrong. What matters is that a move is kept whole
// — where it came from, where it went, who did it — and that a change which was
// not a change is not written down at all.

let reachable = false;
let employeeId = "";
let entryId = "";
let jobId = "";
let projectId = "";
let taskId = "";
let sectionId = "";

before(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    reachable = true;
  } catch {
    return;
  }

  const employee = await prisma.employee.create({
    data: { name: "zlog-Wael", email: "zlog-wael@test.local", active: true },
    select: { id: true },
  });
  employeeId = employee.id;

  const project = await prisma.project.create({
    data: { name: "zlog-Project", token: `zlog-${Date.now()}`, clientName: "zlog" },
    select: { id: true },
  });
  projectId = project.id;

  const section = await prisma.processSection.create({
    data: { name: "zlog-Section", order: 950 },
    select: { id: true },
  });
  sectionId = section.id;

  const task = await prisma.processTask.create({
    data: { name: "zlog-Step", order: 950, sectionId: section.id },
    select: { id: true },
  });
  taskId = task.id;

  const entry = await prisma.projectTaskEntry.create({
    data: { projectId: project.id, taskId: task.id, assigneeId: employee.id, state: "TODO" },
    select: { id: true },
  });
  entryId = entry.id;

  const job = await prisma.assignedTask.create({
    data: {
      employeeId: employee.id,
      title: "zlog-Job",
      startDay: new Date("2026-09-06T00:00:00.000Z"),
      endDay: new Date("2026-09-06T00:00:00.000Z"),
    },
    select: { id: true },
  });
  jobId = job.id;
});

after(async () => {
  if (!reachable) return;
  await prisma.taskStateChange.deleteMany({ where: { OR: [{ entryId }, { assignedTaskId: jobId }] } }).catch(() => null);
  await prisma.assignedTask.deleteMany({ where: { id: jobId } }).catch(() => null);
  await prisma.projectTaskEntry.deleteMany({ where: { projectId } }).catch(() => null);
  await prisma.processTask.deleteMany({ where: { id: taskId } }).catch(() => null);
  await prisma.processSection.deleteMany({ where: { id: sectionId } }).catch(() => null);
  await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => null);
  await prisma.employee.deleteMany({ where: { id: employeeId } }).catch(() => null);
});

describe("writing a move down", () => {
  it("keeps where it came from, where it went, and who did it", async (t) => {
    if (!reachable) return t.skip("no database");

    await recordStateChange({
      entryId,
      from: "TODO",
      to: "IN_PROGRESS",
      actor: "employee",
      actorEmployeeId: employeeId,
    });

    const row = await prisma.taskStateChange.findFirst({ where: { entryId }, orderBy: { createdAt: "desc" } });

    assert.equal(row?.fromState, "TODO");
    assert.equal(row?.toState, "IN_PROGRESS");
    assert.equal(row?.actorType, "employee");
    assert.equal(row?.actorEmployeeId, employeeId);
    assert.equal(row?.automatic, false);
  });

  it("keeps the reason a manager gave", async (t) => {
    if (!reachable) return t.skip("no database");

    await recordStateChange({
      entryId,
      from: "SUBMITTED",
      to: "IN_PROGRESS",
      actor: "manager",
      reason: "  The dimensions are missing  ",
    });

    const row = await prisma.taskStateChange.findFirst({ where: { entryId }, orderBy: { createdAt: "desc" } });

    assert.equal(row?.actorType, "manager");
    assert.equal(row?.reason, "The dimensions are missing");
    assert.equal(row?.actorEmployeeId, null);
  });

  it("marks an automatic change as one", async (t) => {
    if (!reachable) return t.skip("no database");

    await recordStateChange({ entryId, from: "IN_PROGRESS", to: "TODO", actor: "system" });
    const row = await prisma.taskStateChange.findFirst({ where: { entryId }, orderBy: { createdAt: "desc" } });

    assert.equal(row?.automatic, true);
  });

  it("writes nothing for a move that did not move", async (t) => {
    if (!reachable) return t.skip("no database");

    const before = await prisma.taskStateChange.count({ where: { entryId } });
    await recordStateChange({ entryId, from: "DONE", to: "DONE", actor: "manager" });

    assert.equal(await prisma.taskStateChange.count({ where: { entryId } }), before);
  });

  it("records a week-board job the same way", async (t) => {
    if (!reachable) return t.skip("no database");

    await recordStateChange({ assignedTaskId: jobId, from: "TODO", to: "SUBMITTED", actor: "employee", actorEmployeeId: employeeId });
    const row = await prisma.taskStateChange.findFirst({ where: { assignedTaskId: jobId } });

    assert.equal(row?.toState, "SUBMITTED");
    assert.equal(row?.entryId, null);
  });
});

describe("reading the record back", () => {
  it("is oldest first, and says what each move was", async (t) => {
    if (!reachable) return t.skip("no database");

    const rows = await changesFor({ entryId });

    assert.ok(rows.length >= 3);
    const times = rows.map((row) => row.createdAt.getTime());
    assert.deepEqual([...times].sort((a, b) => a - b), times);
    assert.equal(rows[0].said, "started");
    assert.ok(rows.some((row) => row.said === "sent back for changes"));
  });

  it("knows when the work was first started, from the record rather than a column", async (t) => {
    if (!reachable) return t.skip("no database");

    const at = await firstStartedAt(entryId);
    const firstStart = await prisma.taskStateChange.findFirst({
      where: { entryId, toState: "IN_PROGRESS" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });

    assert.equal(at?.getTime(), firstStart?.createdAt.getTime());
  });

  it("has nothing to say about a task nothing happened to", async (t) => {
    if (!reachable) return t.skip("no database");

    assert.deepEqual(await changesFor({ entryId: "no-such-entry" }), []);
    assert.equal(await firstStartedAt("no-such-entry"), null);
  });
});
