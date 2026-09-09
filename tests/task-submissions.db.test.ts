import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { countPendingSubmissions, pendingSubmissions, submissionsForEntry } from "@/lib/submissions";
import { notifyAdmin, countUnreadAdminAlerts, markAdminAlertsRead } from "@/lib/admin-notifications";
import { dispatchNotification } from "@/lib/notifications/engine";
import { getEmployeeProgress } from "@/lib/analytics-queries";
import { runPerformanceReview } from "@/lib/analytics-run";
import { planForProjects } from "@/lib/stage-deadlines";
import { PERFORMANCE_KIND, PERFORMANCE_PENALTY } from "@/lib/analytics";

// The evidence loop, the manager's feed and the month's numbers, against a
// real database — the guarantees that only a unique index can actually make.
//
// Run with: npm run test:db   (needs the local dev database up)

const PREFIX = "zsub-";
const startedAt = new Date();
const PERIOD = new Date().toISOString().slice(0, 7);

let reachable = false;
let employeeId = "";
let projectId = "";
let entryId = "";
let stepIds: string[] = [];

async function cleanup() {
  await prisma.adminNotification.deleteMany({ where: { createdAt: { gte: startedAt } } });
  await prisma.notification.deleteMany({ where: { createdAt: { gte: startedAt } } });
  await prisma.notificationDelivery.deleteMany({ where: { createdAt: { gte: startedAt } } });
  await prisma.salaryAdjustment.deleteMany({ where: { employee: { name: { startsWith: PREFIX } } } });
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

  const employee = await prisma.employee.create({
    data: { name: `${PREFIX}Rami`, email: `${PREFIX}rami@test.local`, active: true, salaryAmount: 500 },
  });
  employeeId = employee.id;

  const project = await prisma.project.create({
    data: { name: `${PREFIX}Project`, token: `${PREFIX}${Date.now()}`, clientName: "Test Client" },
  });
  projectId = project.id;

  // Three stages of two days each, owned by this employee.
  const steps = [];
  for (const [index, name] of [`${PREFIX}Plan`, `${PREFIX}Model`, `${PREFIX}Visit`].entries()) {
    steps.push(
      await prisma.processTask.create({
        data: { name, employeeId, order: 900 + index, durationDays: 2 },
      })
    );
  }
  stepIds = steps.map((step) => step.id);

  const entry = await prisma.projectTaskEntry.create({
    data: { projectId, taskId: stepIds[0], state: "IN_PROGRESS" },
  });
  entryId = entry.id;
});

after(async () => {
  if (reachable) await cleanup();
  await prisma.$disconnect();
});

describe("the evidence loop", () => {
  let submissionId = "";

  it("puts a photo in front of the manager instead of marking the task done", async (t) => {
    if (!reachable) return t.skip("no database");

    const submission = await prisma.taskSubmission.create({
      data: {
        entryId,
        employeeId,
        imageUrl: "/uploads/submissions/test/proof.jpg",
        note: "Done, see photo.",
      },
    });
    submissionId = submission.id;

    await prisma.projectTaskEntry.update({
      where: { id: entryId },
      data: { state: "SUBMITTED", completedAt: null },
    });

    const entry = await prisma.projectTaskEntry.findUniqueOrThrow({ where: { id: entryId } });
    assert.equal(entry.state, "SUBMITTED");
    // Nothing is complete until somebody has looked at the picture.
    assert.equal(entry.completedAt, null);

    const queue = await pendingSubmissions();
    assert.ok(queue.some((row) => row.id === submissionId));
    assert.ok((await countPendingSubmissions()) >= 1);
  });

  it("tells the manager once, however many times the request is retried", async (t) => {
    if (!reachable) return t.skip("no database");

    const key = `TASK_SUBMITTED:${submissionId}`;
    const first = await notifyAdmin({
      type: "TASK_SUBMITTED",
      title: "Rami finished a task",
      message: "Plan — Project.",
      url: "/admin/reviews",
      dedupeKey: key,
      entryId,
      employeeId,
    });
    const second = await notifyAdmin({
      type: "TASK_SUBMITTED",
      title: "Rami finished a task",
      message: "Plan — Project.",
      url: "/admin/reviews",
      dedupeKey: key,
      entryId,
      employeeId,
    });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.skipped, "duplicate");
    assert.equal(await prisma.adminNotification.count({ where: { dedupeKey: key } }), 1);
  });

  it("marks the manager's feed read", async (t) => {
    if (!reachable) return t.skip("no database");

    assert.ok((await countUnreadAdminAlerts()) >= 1);
    await markAdminAlertsRead();
    assert.equal(await countUnreadAdminAlerts(), 0);
  });

  it("completes the task only when the manager approves, and says so once", async (t) => {
    if (!reachable) return t.skip("no database");

    await prisma.taskSubmission.update({
      where: { id: submissionId },
      data: { status: "APPROVED", reviewedAt: new Date(), reviewNote: "Looks right." },
    });
    await prisma.projectTaskEntry.update({
      where: { id: entryId },
      data: { state: "DONE", completedAt: new Date() },
    });

    const told = async () =>
      dispatchNotification({
        employeeId,
        type: "SYSTEM_NOTIFICATION",
        title: "Work approved",
        message: "Plan was approved.",
        url: `/employee/tasks/${entryId}`,
        entryId,
        dedupeKey: `SUBMISSION_APPROVED:${submissionId}`,
      });

    assert.equal((await told()).created, true);
    assert.equal((await told()).skipped, "duplicate");

    const entry = await prisma.projectTaskEntry.findUniqueOrThrow({ where: { id: entryId } });
    assert.equal(entry.state, "DONE");
    assert.ok(entry.completedAt);

    // And it has left the queue.
    const queue = await pendingSubmissions();
    assert.equal(queue.some((row) => row.id === submissionId), false);
  });

  it("keeps the attempt on the task's own history", async (t) => {
    if (!reachable) return t.skip("no database");

    const history = await submissionsForEntry(entryId);
    assert.equal(history.length, 1);
    assert.equal(history[0].status, "APPROVED");
    assert.equal(history[0].reviewNote, "Looks right.");
  });
});

describe("stage periods against real rows", () => {
  it("chains the deadlines and covers cells that have no row yet", async (t) => {
    if (!reachable) return t.skip("no database");

    const plan = await planForProjects([projectId]);

    const first = plan.get(entryId);
    assert.ok(first?.dueBy, "the started stage has a deadline");
    assert.equal(first!.source, "derived");

    // The two stages after it have never been touched, so they have no id —
    // and still take part, which is what makes them chaseable.
    const untouched = [...plan.values()].filter(
      (stage) => stepIds.slice(1).includes(stage.taskId) && stage.entryId === null
    );
    assert.equal(untouched.length, 2);
    assert.ok(untouched.every((stage) => stage.dueBy));
    assert.ok(untouched.every((stage) => stage.ownerId === employeeId));

    const ordered = stepIds.map((id) => [...plan.values()].find((stage) => stage.taskId === id)!);

    // The first stage was approved a moment ago, so the second starts from
    // when it actually finished rather than from when it was predicted to.
    const finishedAt = (await prisma.projectTaskEntry.findUniqueOrThrow({ where: { id: entryId } })).completedAt!;
    assert.deepEqual(ordered[1].startsAt, finishedAt);
    assert.deepEqual(ordered[1].dueBy, new Date(finishedAt.getTime() + 2 * 24 * 60 * 60 * 1000));

    // And the third follows the second, two days behind it.
    assert.ok(ordered[2].dueBy! > ordered[1].dueBy!);
    assert.deepEqual(ordered[2].startsAt, ordered[1].dueBy);
  });
});

describe("the month's numbers", () => {
  it("counts what this employee finished, and deducts once for a shortfall", async (t) => {
    if (!reachable) return t.skip("no database");

    // Two more cells for the same person, neither of them done.
    await prisma.projectTaskEntry.create({ data: { projectId, taskId: stepIds[1], state: "TODO" } });
    await prisma.projectTaskEntry.create({ data: { projectId, taskId: stepIds[2], state: "TODO" } });

    const before = await getEmployeeProgress(PERIOD);
    const mine = before.find((row) => row.employee.id === employeeId);
    assert.ok(mine, "the employee appears in the table");
    assert.equal(mine!.counts.total, 3);
    assert.equal(mine!.counts.completed, 1);
    assert.equal(mine!.shortfall, true);

    const first = await runPerformanceReview(PERIOD);
    const mineFirst = first.outcomes.find((row) => row.employeeId === employeeId);
    assert.equal(mineFirst?.deducted, true);

    const second = await runPerformanceReview(PERIOD);
    const mineSecond = second.outcomes.find((row) => row.employeeId === employeeId);
    // Reported, but not charged again.
    assert.equal(mineSecond?.deducted, false);

    const rows = await prisma.salaryAdjustment.findMany({
      where: { employeeId, periodKey: PERIOD, kind: PERFORMANCE_KIND },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amount, PERFORMANCE_PENALTY);
    assert.match(rows[0].reason, /below the 90% target/);
  });

  it("leaves out the cells the manager marked as not counted", async (t) => {
    if (!reachable) return t.skip("no database");

    await prisma.projectTaskEntry.updateMany({
      where: { projectId, taskId: { in: [stepIds[1], stepIds[2]] } },
      data: { excludedFromProgress: true },
    });

    const after = await getEmployeeProgress(PERIOD);
    const mine = after.find((row) => row.employee.id === employeeId);

    // One task, and it is done: nothing left to fall short of.
    assert.equal(mine!.counts.total, 1);
    assert.equal(mine!.counts.completed, 1);
    assert.equal(mine!.progress, 1);
    assert.equal(mine!.shortfall, false);
  });
});
