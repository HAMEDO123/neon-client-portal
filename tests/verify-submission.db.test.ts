import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { verifySubmission } from "@/lib/ai/verify-submission";

// The paths worth proving are the ones that must never flatter the work: no
// criteria to check against, and a photo the model cannot open. Both end at
// "waiting for the manager", and neither needs a key or a network — which is
// exactly why they are the ones a test can pin down.

let reachable = false;
let employeeId = "";
let entryId = "";
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
    data: { name: "zver-Wael", email: "zver-wael@test.local", active: true },
    select: { id: true },
  });
  employeeId = employee.id;

  const project = await prisma.project.create({
    data: { name: "zver-Project", token: `zver-${Date.now()}`, clientName: "zver" },
    select: { id: true },
  });
  projectId = project.id;

  const section = await prisma.processSection.create({
    data: { name: "zver-Section", order: 960 },
    select: { id: true },
  });
  sectionId = section.id;

  const task = await prisma.processTask.create({
    data: { name: "zver-Step", order: 960, sectionId: section.id },
    select: { id: true },
  });
  taskId = task.id;

  const entry = await prisma.projectTaskEntry.create({
    data: { projectId: project.id, taskId: task.id, assigneeId: employee.id, state: "IN_PROGRESS" },
    select: { id: true },
  });
  entryId = entry.id;
});

after(async () => {
  if (!reachable) return;
  await prisma.taskSubmission.deleteMany({ where: { employeeId } }).catch(() => null);
  await prisma.projectTaskEntry.deleteMany({ where: { projectId } }).catch(() => null);
  await prisma.processTask.deleteMany({ where: { id: taskId } }).catch(() => null);
  await prisma.processSection.deleteMany({ where: { id: sectionId } }).catch(() => null);
  await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => null);
  await prisma.employee.deleteMany({ where: { id: employeeId } }).catch(() => null);
});

async function submit(imageUrl: string) {
  return prisma.taskSubmission.create({
    data: { entryId, employeeId, imageUrl, note: "Finished it" },
    select: { id: true },
  });
}

describe("when there is nothing to check against", () => {
  it("waits for the manager rather than passing the work", async (t) => {
    if (!reachable) return t.skip("no database");

    await prisma.projectTaskEntry.update({
      where: { id: entryId },
      data: { acceptance: null, deliverable: null },
    });
    const submission = await submit("https://example.com/proof.jpg");

    const result = await verifySubmission(submission.id);

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.outcome, "human-review");
    assert.equal(result.ok && result.checks.length, 0);
    assert.match((result.ok && result.note) || "", /nothing to check against/i);

    const stored = await prisma.taskSubmission.findUnique({
      where: { id: submission.id },
      select: { outcome: true, checkedAt: true, status: true },
    });
    assert.equal(stored?.outcome, "human-review");
    assert.ok(stored?.checkedAt);
    // The check never touches what a person decided.
    assert.equal(stored?.status, "PENDING");
  });
});

describe("when the photo cannot be opened", () => {
  it("says so against every criterion instead of judging the work", async (t) => {
    if (!reachable) return t.skip("no database");

    await prisma.projectTaskEntry.update({
      where: { id: entryId },
      data: { acceptance: "Every room labelled\nDimensions on every wall" },
    });
    const submission = await submit("/uploads/local-only.jpg");

    const result = await verifySubmission(submission.id);

    assert.equal(result.ok && result.outcome, "human-review");
    assert.equal(result.ok && result.checks.length, 2);
    assert.ok(result.ok && result.checks.every((check) => check.verdict === "cannot-tell"));

    const rows = await prisma.submissionCheck.findMany({ where: { submissionId: submission.id } });
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => (row.gap ?? "").includes("could not be opened")));
    // The criteria are copied onto the rows, not read live.
    assert.deepEqual(rows.map((row) => row.required).sort(), [
      "Dimensions on every wall",
      "Every room labelled",
    ]);
  });

  it("replaces its verdicts when it runs again, rather than piling them up", async (t) => {
    if (!reachable) return t.skip("no database");

    const submission = await submit("/uploads/local-only.jpg");

    await verifySubmission(submission.id);
    await verifySubmission(submission.id);

    assert.equal(await prisma.submissionCheck.count({ where: { submissionId: submission.id } }), 2);
  });
});

describe("a submission that is not there", () => {
  it("says so plainly", async (t) => {
    if (!reachable) return t.skip("no database");

    const result = await verifySubmission("no-such-submission");

    assert.equal(result.ok, false);
    assert.match((!result.ok && result.error) || "", /no longer exists/i);
  });
});
