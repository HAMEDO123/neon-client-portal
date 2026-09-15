import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { channelFor, getTeamChannel, listMessages, type ChatViewer } from "@/lib/chat";
import { peerConversation } from "@/lib/chat-conversations";
import {
  addChatTaskCommentRecord,
  createChatTaskRecords,
  taskListFor,
  taskMembers,
  taskSignature,
  taskSnapshot,
} from "@/lib/chat-task-store";
import { myAssignedTasks } from "@/lib/assigned-tasks";
import { dateToDayKey } from "@/lib/time";

// Task cards against a real database: that a card hands each person on it an
// ordinary job, all at once or not at all; that the live stream's signature
// moves on everything that changes a card without a new message; that the
// Tasks list shows a card to the manager and the people on it, and nobody
// else; and that deleting the message takes the card, every part and the
// thread with it.
//
// Run with: npm run test:db   (needs the local dev database up)

const PREFIX = "ztest-ctask-";
const manager: ChatViewer = { type: "ADMIN", id: null, name: "Manager" };

let reachable = false;
let amal: Extract<ChatViewer, { type: "EMPLOYEE" }>;
let basel: Extract<ChatViewer, { type: "EMPLOYEE" }>;
let carla: Extract<ChatViewer, { type: "EMPLOYEE" }>;
let teamId: string;

const today = dateToDayKey(new Date())!;
const tomorrow = dateToDayKey(new Date(Date.now() + 24 * 60 * 60_000))!;

async function cleanup() {
  // The card, its parts and its thread go with the message.
  await prisma.chatMessage.deleteMany({ where: { kind: "TASK", body: { startsWith: PREFIX } } });
  const people = await prisma.employee.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  if (people.length > 0) {
    await prisma.chatChannel.deleteMany({ where: { OR: people.map((person) => ({ key: { contains: person.id } })) } });
  }
  await prisma.employee.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

async function person(name: string) {
  const row = await prisma.employee.create({
    data: { name: `${PREFIX}${name}`, email: `${PREFIX}${name.toLowerCase()}@test.local`, active: true, accessRole: "EMPLOYEE" },
  });
  return { type: "EMPLOYEE" as const, id: row.id, name: row.name };
}

function card(title: string, assigneeIds: string[], channelId = teamId) {
  return createChatTaskRecords({
    channelId,
    authorName: "Manager",
    title: `${PREFIX}${title}`,
    description: "Bring two colours of each.",
    dueAt: new Date(Date.now() + 24 * 60 * 60_000),
    dueDayKey: tomorrow,
    todayKey: today,
    priority: "HIGH",
    assigneeIds,
    attachment: null,
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
  carla = await person("Carla");
  teamId = (await getTeamChannel()).id;
});

after(async () => {
  if (reachable) await cleanup();
  await prisma.$disconnect();
});

describe("a task card", () => {
  it("can go to everyone on the team in the group, only the one person in a private chat, and nobody between two employees", async (t) => {
    if (!reachable) return t.skip("no database");

    const team = (await taskMembers({ kind: "team" })).map((member) => member.id);
    assert.ok([amal.id, basel.id, carla.id].every((id) => team.includes(id)));

    assert.deepEqual(
      (await taskMembers({ kind: "direct", employeeId: amal.id })).map((member) => member.id),
      [amal.id]
    );
    assert.deepEqual(await taskMembers(peerConversation(amal.id, basel.id)), []);
  });

  it("hands each person on it an ordinary job, from today to the day it is due", async (t) => {
    if (!reachable) return t.skip("no database");

    const created = await card("Collect tile samples", [amal.id, basel.id]);
    assert.equal(created.message.kind, "TASK");
    assert.equal(created.message.body, `${PREFIX}Collect tile samples`, "the title is what the chat list and a lock screen show");
    assert.equal(created.message.task?.id, created.taskId, "the message arrives with its card");
    assert.equal(created.message.task?.assignments.length, 2);

    const jobs = await prisma.assignedTask.findMany({ where: { chatTaskId: created.taskId }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(jobs.map((job) => job.employeeId).sort(), [amal.id, basel.id].sort());
    for (const job of jobs) {
      assert.equal(job.state, "TODO");
      assert.equal(job.priority, "HIGH");
      assert.equal(job.note, "Bring two colours of each.");
      assert.equal(dateToDayKey(job.startDay), today);
      assert.equal(dateToDayKey(job.endDay), tomorrow);
    }

    assert.ok(
      (await myAssignedTasks(amal.id)).some((job) => job.title === `${PREFIX}Collect tile samples`),
      "on Amal's own list, like any job"
    );

    const team = await channelFor(amal, { kind: "team" });
    const seen = (await listMessages(amal, team!.id)).find((message) => message.id === created.message.id);
    assert.equal(seen?.task?.title, `${PREFIX}Collect tile samples`, "and in the conversation, drawn");
  });

  it("is written all at once or not at all", async (t) => {
    if (!reachable) return t.skip("no database");

    await assert.rejects(card("Half a task", [amal.id, "nobodyatall00000000"]));
    assert.equal(await prisma.chatMessage.count({ where: { body: `${PREFIX}Half a task` } }), 0, "no message left behind");
    assert.equal(await prisma.chatTask.count({ where: { title: `${PREFIX}Half a task` } }), 0, "no card");
    assert.equal(await prisma.assignedTask.count({ where: { title: `${PREFIX}Half a task` } }), 0, "and no job for Amal");
  });

  it("moves the live signature on everything that changes it without a new message", async (t) => {
    if (!reachable) return t.skip("no database");

    const created = await card("Measure the kitchen", [amal.id]);
    const job = await prisma.assignedTask.findFirstOrThrow({ where: { chatTaskId: created.taskId } });

    const signatures = [await taskSignature(teamId)];
    const moved = async (what: string) => {
      const next = await taskSignature(teamId);
      assert.notEqual(next, signatures.at(-1), what);
      signatures.push(next);
    };

    await prisma.assignedTask.update({ where: { id: job.id }, data: { state: "IN_PROGRESS" } });
    await moved("somebody starting their part");

    await prisma.taskSubmission.create({ data: { assignedTaskId: job.id, employeeId: amal.id, imageUrl: "/x.jpg" } });
    await moved("a photo sent for review");

    await addChatTaskCommentRecord(created.taskId, amal, "Measured, sending the sketch");
    await moved("a comment");

    await prisma.taskSubmission.updateMany({ where: { assignedTaskId: job.id }, data: { status: "APPROVED" } });
    await moved("the photo reviewed");

    assert.equal(await taskSignature(teamId), signatures.at(-1), "and stays put when nothing changed");

    const snapshot = await taskSnapshot(teamId);
    assert.ok(snapshot.ids.includes(created.taskId));
    const drawn = snapshot.tasks.find((task) => task.id === created.taskId);
    assert.equal(drawn?.assignments[0].state, "IN_PROGRESS");
    assert.equal(drawn?._count.comments, 1);
    assert.equal(drawn?.comments[0].body, "Measured, sending the sketch");
    assert.equal(drawn?.comments[0].authorId, amal.id);
  });

  it("is listed for the manager and the people on it, as each of them names its chat, and for nobody else", async (t) => {
    if (!reachable) return t.skip("no database");

    const inGroup = await card("Order the grout", [basel.id]);
    const direct = await channelFor(manager, { kind: "direct", employeeId: amal.id });
    const inPrivate = await card("Call the supplier", [amal.id], direct!.id);

    const basels = await taskListFor(basel);
    assert.ok(basels.some((item) => item.id === inGroup.taskId && item.conversationSlug === "team" && item.isGroup));
    assert.ok(!basels.some((item) => item.id === inPrivate.taskId), "not somebody else's private task");

    const amals = await taskListFor(amal);
    const own = amals.find((item) => item.id === inPrivate.taskId);
    assert.equal(own?.conversationSlug, "manager");
    assert.equal(own?.conversationTitle, "Manager");
    assert.ok(!amals.some((item) => item.id === inGroup.taskId), "a group task Amal is not on is not on Amal's list");

    const carlas = await taskListFor(carla);
    assert.ok(!carlas.some((item) => item.id === inGroup.taskId || item.id === inPrivate.taskId));

    const managers = await taskListFor(manager);
    assert.equal(managers.find((item) => item.id === inPrivate.taskId)?.conversationSlug, amal.id);
    assert.ok(managers.some((item) => item.id === inGroup.taskId));
  });

  it("goes with its message: the card, every part of it and the thread", async (t) => {
    if (!reachable) return t.skip("no database");

    const created = await card("Photograph the site", [amal.id, carla.id]);
    await addChatTaskCommentRecord(created.taskId, manager, "Both angles please");
    const before = await taskSignature(teamId);

    await prisma.chatMessage.delete({ where: { id: created.message.id } });

    assert.equal(await prisma.chatTask.count({ where: { id: created.taskId } }), 0);
    assert.equal(await prisma.assignedTask.count({ where: { chatTaskId: created.taskId } }), 0);
    assert.equal(await prisma.chatTaskComment.count({ where: { chatTaskId: created.taskId } }), 0);
    assert.notEqual(await taskSignature(teamId), before, "and the open chats hear that it went");
    assert.ok(!(await taskSnapshot(teamId)).ids.includes(created.taskId));
  });
});
