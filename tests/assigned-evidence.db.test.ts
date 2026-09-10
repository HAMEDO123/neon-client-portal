import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { myAssignedTask, myAssignedTasks } from "@/lib/assigned-tasks";
import { pendingSubmissions, submissionsForAssignedTask, submissionsForEntry } from "@/lib/submissions";

// A job the manager hands out by hand follows the same rule as a board cell:
// the employee sends a photo, and only the manager's approval makes it done.
// These are the guarantees about rows — that evidence can point at a job with
// no board cell behind it, that the review queue names it, that approving and
// returning it land on the job, and that nobody else can reach it.
//
// Run with: npm run test:db   (needs the local dev database up)

const PREFIX = "zjob-";
const startedAt = new Date();

let reachable = false;
let owner = "";
let stranger = "";
let jobId = "";
let submissionId = "";

async function cleanup() {
  await prisma.adminNotification.deleteMany({ where: { createdAt: { gte: startedAt } } });
  await prisma.taskSubmission.deleteMany({ where: { employee: { name: { startsWith: PREFIX } } } });
  await prisma.assignedTask.deleteMany({ where: { title: { startsWith: PREFIX } } });
  await prisma.employee.deleteMany({ where: { name: { startsWith: PREFIX } } });
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

  const [a, b] = await Promise.all([
    prisma.employee.create({ data: { name: `${PREFIX}Wael`, email: `${PREFIX}wael@test.local`, active: true } }),
    prisma.employee.create({ data: { name: `${PREFIX}Sally`, email: `${PREFIX}sally@test.local`, active: true } }),
  ]);
  owner = a.id;
  stranger = b.id;

  const job = await prisma.assignedTask.create({
    data: {
      employeeId: owner,
      title: `${PREFIX}Negotiate with the marble supplier`,
      startDay: new Date("2026-09-10T00:00:00.000Z"),
      endDay: new Date("2026-09-10T00:00:00.000Z"),
      state: "IN_PROGRESS",
    },
  });
  jobId = job.id;
});

after(async () => {
  if (reachable) await cleanup();
  await prisma.$disconnect();
});

describe("a job from the manager is reachable only by its owner", () => {
  it("opens for the employee it was given to", async (t) => {
    if (!reachable) return t.skip("no database");
    const job = await myAssignedTask(owner, jobId);
    assert.equal(job?.id, jobId);
    assert.equal(job?.startKey, "2026-09-10");
  });

  it("is simply not found for anybody else", async (t) => {
    if (!reachable) return t.skip("no database");
    assert.equal(await myAssignedTask(stranger, jobId), null);
    assert.equal((await myAssignedTasks(stranger)).some((job) => job.id === jobId), false);
  });
});

describe("finishing a job means sending proof", () => {
  it("records evidence for a job that has no board cell behind it", async (t) => {
    if (!reachable) return t.skip("no database");

    const submission = await prisma.taskSubmission.create({
      data: { assignedTaskId: jobId, employeeId: owner, imageUrl: "/uploads/submissions/test/proof.jpg" },
    });
    submissionId = submission.id;
    await prisma.assignedTask.update({ where: { id: jobId }, data: { state: "SUBMITTED" } });

    assert.equal(submission.entryId, null);
    assert.equal(submission.assignedTaskId, jobId);
    assert.equal((await myAssignedTask(owner, jobId))?.state, "SUBMITTED");
  });

  it("puts it in the manager's queue under its own name", async (t) => {
    if (!reachable) return t.skip("no database");

    const queued = (await pendingSubmissions()).find((row) => row.id === submissionId);
    assert.ok(queued, "the submission is waiting for review");
    assert.equal(queued!.entry, null);
    assert.equal(queued!.assignedTask?.title, `${PREFIX}Negotiate with the marble supplier`);
  });

  it("keeps a job's evidence apart from the board's", async (t) => {
    if (!reachable) return t.skip("no database");

    assert.equal((await submissionsForAssignedTask(jobId)).length, 1);
    // An entry lookup must never pick up evidence that belongs to a job.
    assert.equal((await submissionsForEntry(jobId)).length, 0);
  });

  it("is done once approved, and back in progress once returned", async (t) => {
    if (!reachable) return t.skip("no database");

    // What settle() does for a job, on approval and then on a second attempt
    // that gets sent back.
    await prisma.taskSubmission.update({ where: { id: submissionId }, data: { status: "APPROVED" } });
    await prisma.assignedTask.update({ where: { id: jobId }, data: { state: "DONE", completedAt: new Date() } });

    const approved = await myAssignedTask(owner, jobId);
    assert.equal(approved?.state, "DONE");
    // A finished job leaves the open list the dashboard reads.
    assert.equal((await myAssignedTasks(owner)).some((job) => job.id === jobId), false);
    assert.equal((await myAssignedTasks(owner, { includeDone: true })).some((job) => job.id === jobId), true);

    await prisma.assignedTask.update({ where: { id: jobId }, data: { state: "IN_PROGRESS", completedAt: null } });
    assert.equal((await myAssignedTask(owner, jobId))?.state, "IN_PROGRESS");
  });

  it("takes its evidence with it when the job is deleted", async (t) => {
    if (!reachable) return t.skip("no database");

    await prisma.assignedTask.delete({ where: { id: jobId } });
    assert.equal(await prisma.taskSubmission.count({ where: { id: submissionId } }), 0);
  });
});
