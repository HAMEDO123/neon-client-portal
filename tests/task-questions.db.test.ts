import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { channelFor, listMessages, type ChatViewer } from "@/lib/chat";
import { questionsAbout, taskAskedAbout } from "@/lib/task-question-store";
import { questionBody } from "@/lib/task-questions";
import { dayKeyToDate } from "@/lib/time";
import { databaseTarget } from "./db-target";

// Refuses the studio's live database outright — see tests/db-target.ts. At the
// top of the file on purpose: inside `before` the throw reads as a skip.
const target = databaseTarget(process.env.DATABASE_URL);
if (!target.safe) throw new Error(target.why);

// Asking about a task, against a real database: that a task can only be asked
// about by whoever it belongs to, that the question arrives in the chat saying
// which task it was, that the task's page can list what was asked, and that
// deleting the task leaves the question where it was said.
//
// The messages are written straight into the table rather than through
// postChatMessage, which tells people: in a development database loaded from a
// copy of the studio's, "people" have real phones.
//
// Run with: npm run test:db   (needs the local dev database up)

const PREFIX = "ztest-ask-";
const manager: ChatViewer = { type: "ADMIN", id: null, name: "Manager" };

let reachable = false;
let amal: Extract<ChatViewer, { type: "EMPLOYEE" }>;
let basel: Extract<ChatViewer, { type: "EMPLOYEE" }>;
let jobId = "";

async function cleanup() {
  const people = await prisma.employee.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  const ids = people.map((person) => person.id);
  if (ids.length > 0) {
    // Their messages first: an author is set to null when the person goes, and
    // a line in the team's own channel would be left behind with nobody on it.
    await prisma.chatMessage.deleteMany({ where: { authorId: { in: ids } } });
    await prisma.chatChannel.deleteMany({ where: { OR: ids.map((id) => ({ key: { contains: id } })) } });
  }
  await prisma.employee.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

async function person(name: string) {
  const row = await prisma.employee.create({
    data: { name: `${PREFIX}${name}`, email: `${PREFIX}${name.toLowerCase()}@test.local`, active: true, accessRole: "EMPLOYEE" },
  });
  return { type: "EMPLOYEE" as const, id: row.id, name: row.name };
}

async function ask(from: Extract<ChatViewer, { type: "EMPLOYEE" }>, channelId: string, text: string) {
  const about = (await taskAskedAbout(from.id, "assigned", jobId))!;
  return prisma.chatMessage.create({
    data: {
      channelId,
      authorType: "EMPLOYEE",
      authorId: from.id,
      authorName: from.name,
      kind: "TEXT",
      body: questionBody(about.aboutTitle!, text),
      ...about,
    },
  });
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

  // One at a time: fixtures built concurrently are what the local database falls over on.
  amal = await person("Amal");
  basel = await person("Basel");
  const job = await prisma.assignedTask.create({
    data: {
      employeeId: amal.id,
      title: "تنظيف الشركة",
      startDay: dayKeyToDate("2026-10-10"),
      endDay: dayKeyToDate("2026-10-10"),
      priority: "HIGH",
    },
  });
  jobId = job.id;
});

after(async () => {
  if (reachable) await cleanup();
  await prisma.$disconnect();
});

describe("asking about a task", () => {
  it("is for whoever the task belongs to, and nobody else", async (t) => {
    if (!reachable) return t.skip("no database");

    assert.deepEqual(await taskAskedAbout(amal.id, "assigned", jobId), {
      aboutAssignedTaskId: jobId,
      aboutEntryId: null,
      aboutTitle: "تنظيف الشركة",
    });
    // Not refused: not found. Somebody else's task id tells them nothing.
    assert.equal(await taskAskedAbout(basel.id, "assigned", jobId), null);
    assert.equal(await taskAskedAbout(amal.id, "board", jobId), null, "a job is not a cell of the board");
    assert.equal(await taskAskedAbout(amal.id, "assigned", "nosuchtask"), null);
  });

  it("arrives in the chat saying which task it was", async (t) => {
    if (!reachable) return t.skip("no database");

    const direct = (await channelFor(amal, { kind: "direct", employeeId: amal.id }))!;
    const sent = await ask(amal, direct.id, "متى لازم أخلص؟");

    const seen = (await listMessages(manager, direct.id)).find((message) => message.id === sent.id);
    assert.ok(seen, "the manager reads it in their chat with Amal");
    assert.equal(seen.aboutAssignedTaskId, jobId);
    assert.equal(seen.aboutEntryId, null);
    assert.equal(seen.aboutTitle, "تنظيف الشركة");
    // The text alone still says what it is about, for a lock screen or an older app.
    assert.equal(seen.body, "📋 تنظيف الشركة\nمتى لازم أخلص؟");
  });

  it("is listed on the task's own page, with where each question went", async (t) => {
    if (!reachable) return t.skip("no database");

    const team = (await channelFor(amal, { kind: "team" }))!;
    await ask(amal, team.id, "مين معه المفاتيح؟");

    const asked = await questionsAbout(amal.id, "assigned", jobId);
    assert.deepEqual(
      asked.map((question) => [question.where, question.text]),
      [
        ["team", "مين معه المفاتيح؟"],
        ["manager", "متى لازم أخلص؟"],
      ]
    );
    // Somebody else has asked nothing about it, whatever is in the group.
    assert.deepEqual(await questionsAbout(basel.id, "assigned", jobId), []);
  });

  it("stays where it was said when the task is deleted", async (t) => {
    if (!reachable) return t.skip("no database");

    await prisma.assignedTask.delete({ where: { id: jobId } });

    const left = await prisma.chatMessage.findMany({
      where: { authorId: amal.id },
      select: { aboutAssignedTaskId: true, aboutTitle: true, body: true },
    });
    assert.equal(left.length, 2, "both questions are still in their chats");
    for (const message of left) {
      assert.equal(message.aboutAssignedTaskId, null, "with nowhere left to open");
      assert.equal(message.aboutTitle, "تنظيف الشركة", "and still saying what they were about");
    }
  });
});
