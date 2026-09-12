import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { acceptableDependencies } from "@/lib/task-graph";
import { readinessOf } from "@/lib/task-readiness";
import { generateProjectToken } from "@/lib/tokens";

// Dependencies against the real rows: what the manager's editor writes, and
// what the employee's task then says about itself.
//
// The editor's own action needs a session, so the rule it applies — refuse a
// list that would close a loop — is exercised here through the same pure
// function it calls, against dependencies that really exist in the database.
//
// Run with: npm run test:db   (needs the local dev database up)

const PREFIX = "zdep-";

let reachable = false;
let firstEntry = "";
let secondEntry = "";
let firstName = "";

async function cleanup() {
  await prisma.project.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.processTask.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

/** Every edge in the database, the way the action reads them before deciding. */
function edges() {
  return prisma.taskDependency.findMany({ select: { entryId: true, dependsOnEntryId: true } });
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

  const project = await prisma.project.create({
    data: { name: `${PREFIX}Cafe`, token: generateProjectToken(`${PREFIX}Cafe`), clientName: "Test client" },
  });
  const design = await prisma.processTask.create({ data: { name: `${PREFIX}Design`, order: 900 } });
  const drawings = await prisma.processTask.create({ data: { name: `${PREFIX}Drawings`, order: 901 } });
  firstName = design.name;

  const a = await prisma.projectTaskEntry.create({ data: { projectId: project.id, taskId: design.id } });
  const b = await prisma.projectTaskEntry.create({ data: { projectId: project.id, taskId: drawings.id } });
  firstEntry = a.id;
  secondEntry = b.id;
});

after(async () => {
  if (reachable) await cleanup();
  await prisma.$disconnect();
});

describe("one task waiting for another", () => {
  it("records what the drawings wait for", async (t) => {
    if (!reachable) return t.skip("no database");

    const { accepted, refused } = acceptableDependencies(await edges(), secondEntry, [firstEntry]);
    assert.deepEqual(accepted, [firstEntry]);
    assert.deepEqual(refused, []);

    await prisma.taskDependency.create({ data: { entryId: secondEntry, dependsOnEntryId: firstEntry } });
    assert.equal(await prisma.taskDependency.count({ where: { entryId: secondEntry } }), 1);
  });

  it("refuses the design waiting back on the drawings", async (t) => {
    if (!reachable) return t.skip("no database");

    const { accepted, refused } = acceptableDependencies(await edges(), firstEntry, [secondEntry]);
    assert.deepEqual(accepted, []);
    assert.deepEqual(refused, [secondEntry]);
  });

  it("leaves the waiting task waiting until the first one is done", async (t) => {
    if (!reachable) return t.skip("no database");

    const waiting = await prisma.projectTaskEntry.findUniqueOrThrow({
      where: { id: secondEntry },
      select: {
        state: true,
        blockedReason: true,
        blockedBy: { select: { name: true } },
        waitsFor: { select: { dependsOn: { select: { state: true, task: { select: { name: true } } } } } },
      },
    });

    const readiness = readinessOf({
      state: waiting.state,
      blockedReason: waiting.blockedReason,
      blockedByName: waiting.blockedBy?.name ?? null,
      dependencies: waiting.waitsFor.map((row) => ({
        name: row.dependsOn.task.name,
        done: row.dependsOn.state === "DONE",
      })),
    });

    assert.deepEqual(readiness, { status: "waiting", on: [firstName] });
  });

  it("turns ready the moment the first one is finished, with nothing else written", async (t) => {
    if (!reachable) return t.skip("no database");

    await prisma.projectTaskEntry.update({ where: { id: firstEntry }, data: { state: "DONE" } });

    const waiting = await prisma.projectTaskEntry.findUniqueOrThrow({
      where: { id: secondEntry },
      select: {
        state: true,
        blockedReason: true,
        blockedBy: { select: { name: true } },
        waitsFor: { select: { dependsOn: { select: { state: true, task: { select: { name: true } } } } } },
      },
    });

    const readiness = readinessOf({
      state: waiting.state,
      blockedReason: waiting.blockedReason,
      blockedByName: waiting.blockedBy?.name ?? null,
      dependencies: waiting.waitsFor.map((row) => ({
        name: row.dependsOn.task.name,
        done: row.dependsOn.state === "DONE",
      })),
    });

    assert.deepEqual(readiness, { status: "ready" });
  });

  it("goes with the task when the task is deleted", async (t) => {
    if (!reachable) return t.skip("no database");

    await prisma.projectTaskEntry.delete({ where: { id: firstEntry } });
    assert.equal(await prisma.taskDependency.count({ where: { dependsOnEntryId: firstEntry } }), 0);
  });
});
