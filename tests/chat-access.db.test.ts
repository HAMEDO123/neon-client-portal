import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import {
  channelFor,
  conversationsFor,
  directChannelKey,
  listMessages,
  parseConversation,
  recordChatRead,
  type ChatViewer,
} from "@/lib/chat";
import { peerChannelKey, peerConversation } from "@/lib/chat-conversations";
import { getEmployeeBadges } from "@/lib/employee-badges";
import { getAdminBadges } from "@/lib/admin-badges";
import { latestCues } from "@/lib/cues";

// Private conversations against a real database: that one employee's private
// chat with the manager cannot be opened by another employee, that its
// messages count as unread — and make a sound — for its one employee only, and
// that the manager has one for every person on the team. And that a chat
// between two employees opens for those two alone — never for the manager —
// and counts, sounds and lists for the other one of them only.
//
// Run with: npm run test:db   (needs the local dev database up)

const PREFIX = "ztest-chat-";
const manager: ChatViewer = { type: "ADMIN", id: null, name: "Manager" };

let reachable = false;
let amal: Extract<ChatViewer, { type: "EMPLOYEE" }>;
let basel: Extract<ChatViewer, { type: "EMPLOYEE" }>;
let carla: Extract<ChatViewer, { type: "EMPLOYEE" }>;

async function cleanup() {
  const people = await prisma.employee.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  // Messages and read markers go with their channel: every chat, with the
  // manager or with a colleague, whose key names one of them.
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
});

after(async () => {
  if (reachable) await cleanup();
  await prisma.$disconnect();
});

describe("private conversations", () => {
  it("open for their employee and the manager, and for nobody else", async (t) => {
    if (!reachable) return t.skip("no database");

    const own = await channelFor(amal, { kind: "direct", employeeId: amal.id });
    assert.equal(own?.key, directChannelKey(amal.id));

    assert.equal(await channelFor(basel, { kind: "direct", employeeId: amal.id }), null, "Basel cannot open Amal's");

    const managers = await channelFor(manager, { kind: "direct", employeeId: amal.id });
    assert.equal(managers?.id, own?.id, "the same conversation from both sides");

    assert.equal(
      await channelFor(manager, { kind: "direct", employeeId: "nobodyatall000000" }),
      null,
      "no private chat with somebody who is not on the team"
    );
  });

  it("count and sound for their one employee only", async (t) => {
    if (!reachable) return t.skip("no database");

    const channel = (await channelFor(manager, { kind: "direct", employeeId: amal.id }))!;
    const amalBefore = await getEmployeeBadges(amal.id);
    const baselBefore = await getEmployeeBadges(basel.id);
    const baselCues = await latestCues(basel);

    const message = await prisma.chatMessage.create({
      data: { channelId: channel.id, authorType: "ADMIN", authorName: "Manager", kind: "TEXT", body: "Can you call the supplier?" },
    });

    assert.equal((await getEmployeeBadges(amal.id)).unreadChat - amalBefore.unreadChat, 1);
    assert.equal((await getEmployeeBadges(basel.id)).unreadChat - baselBefore.unreadChat, 0);
    assert.ok((await latestCues(amal)).messages >= message.createdAt.getTime(), "Amal hears it");
    assert.equal((await latestCues(basel)).messages, baselCues.messages, "Basel does not");

    assert.ok((await listMessages(amal, channel.id)).some((row) => row.id === message.id));

    const list = await conversationsFor(amal);
    assert.deepEqual(
      list.slice(0, 2).map((item) => item.slug),
      ["team", "manager"],
      "an employee has the group, then the chat that has just had a message"
    );
    const withManager = list.find((item) => item.slug === "manager");
    assert.equal(withManager?.unread, 1);
    assert.equal(withManager?.last?.body, "Can you call the supplier?");
    assert.ok(list.some((item) => item.slug === basel.id), "and a chat with each colleague, though nothing has been said yet");

    await recordChatRead(amal, channel.id);
    assert.equal(
      (await conversationsFor(amal)).find((item) => item.slug === "manager")?.unread,
      0,
      "reading it clears it"
    );
  });

  it("reach the manager when the employee writes, with a chat for everyone on the team", async (t) => {
    if (!reachable) return t.skip("no database");

    const channel = (await channelFor(amal, { kind: "direct", employeeId: amal.id }))!;
    const before = await getAdminBadges();

    await prisma.chatMessage.create({
      data: {
        channelId: channel.id,
        authorType: "EMPLOYEE",
        authorId: amal.id,
        authorName: amal.name,
        kind: "TEXT",
        body: "Calling now",
      },
    });

    assert.equal((await getAdminBadges()).chat - before.chat, 1);

    const list = await conversationsFor(manager);
    assert.equal(list[0].slug, "team", "the group stays on top");
    const row = list.find((item) => item.slug === amal.id);
    assert.ok(row, "Amal's chat is in the manager's list");
    assert.equal(row.unread, 1);
    assert.ok(list.some((item) => item.slug === basel.id), "so is Basel's, though nothing has been said yet");
    assert.ok(
      list.every((item) => item.conversation.kind !== "peer"),
      "and never a chat between two employees"
    );
  });
});

describe("chats between two employees", () => {
  it("open for the two of them, and for nobody else, not the manager", async (t) => {
    if (!reachable) return t.skip("no database");

    const fromAmal = parseConversation(basel.id, amal)!;
    const fromBasel = parseConversation(amal.id, basel)!;
    const amals = await channelFor(amal, fromAmal);
    const basels = await channelFor(basel, fromBasel);
    assert.equal(amals?.key, peerChannelKey(amal.id, basel.id));
    assert.equal(basels?.id, amals?.id, "the same conversation from both sides");

    assert.equal(await channelFor(carla, fromAmal), null, "Carla cannot open it");
    assert.equal(await channelFor(manager, fromAmal), null, "nor can the manager");
    assert.deepEqual(
      parseConversation(basel.id, manager),
      { kind: "direct", employeeId: basel.id },
      "the manager naming Basel means the manager's own chat with Basel"
    );

    assert.equal(
      await channelFor(amal, peerConversation(amal.id, "nobodyatall000000")),
      null,
      "no chat with somebody who is not on the team"
    );
  });

  it("count, sound and list for the other one only, never for the manager", async (t) => {
    if (!reachable) return t.skip("no database");

    const channel = (await channelFor(amal, peerConversation(amal.id, basel.id)))!;
    const baselBefore = await getEmployeeBadges(basel.id);
    const carlaBefore = await getEmployeeBadges(carla.id);
    const adminBefore = await getAdminBadges();
    const amalCues = await latestCues(amal);
    const carlaCues = await latestCues(carla);
    const managerCues = await latestCues(manager);

    const message = await prisma.chatMessage.create({
      data: {
        channelId: channel.id,
        authorType: "EMPLOYEE",
        authorId: amal.id,
        authorName: amal.name,
        kind: "TEXT",
        body: "Do you have the tile samples?",
      },
    });

    assert.equal((await getEmployeeBadges(basel.id)).unreadChat - baselBefore.unreadChat, 1, "Basel has one to read");
    assert.equal((await getEmployeeBadges(carla.id)).unreadChat - carlaBefore.unreadChat, 0, "Carla does not");
    assert.equal((await getAdminBadges()).chat - adminBefore.chat, 0, "nor does the manager");

    assert.ok((await latestCues(basel)).messages >= message.createdAt.getTime(), "Basel hears it");
    assert.equal((await latestCues(amal)).messages, amalCues.messages, "the sender does not hear their own message");
    assert.equal((await latestCues(carla)).messages, carlaCues.messages, "Carla does not hear it");
    assert.equal((await latestCues(manager)).messages, managerCues.messages, "nor does the manager");

    assert.ok((await listMessages(basel, channel.id)).some((row) => row.id === message.id));

    const basels = (await conversationsFor(basel)).find((item) => item.slug === amal.id);
    assert.ok(basels, "Amal is in Basel's list");
    assert.equal(basels.unread, 1);
    assert.equal(basels.last?.body, "Do you have the tile samples?");
    assert.equal(basels.last?.mine, false);

    const amals = (await conversationsFor(amal)).find((item) => item.slug === basel.id);
    assert.equal(amals?.unread, 0, "your own message is not unread");
    assert.equal(amals?.last?.mine, true);

    const managers = await conversationsFor(manager);
    assert.ok(
      managers.every((item) => item.last?.body !== "Do you have the tile samples?"),
      "nothing of it reaches the manager's list"
    );

    await recordChatRead(basel, channel.id);
    assert.equal(
      (await conversationsFor(basel)).find((item) => item.slug === amal.id)?.unread,
      0,
      "reading it clears it"
    );
    assert.equal((await getEmployeeBadges(basel.id)).unreadChat, baselBefore.unreadChat, "and the badge with it");
  });

  it("stay readable after a colleague leaves, and none starts with somebody who has", async (t) => {
    if (!reachable) return t.skip("no database");

    const withCarla = (await channelFor(amal, peerConversation(amal.id, carla.id)))!;
    await prisma.chatMessage.create({
      data: {
        channelId: withCarla.id,
        authorType: "EMPLOYEE",
        authorId: carla.id,
        authorName: carla.name,
        kind: "TEXT",
        body: "Last day today",
      },
    });
    await prisma.employee.update({ where: { id: carla.id }, data: { active: false } });

    const row = (await conversationsFor(amal)).find((item) => item.slug === carla.id);
    assert.ok(row, "the chat with Carla is still in Amal's list");
    assert.equal(row.subtitle, "No longer on the team");
    assert.equal(row.unread, 1, "so what is unread in it can still be found and read");
    assert.equal((await channelFor(amal, peerConversation(amal.id, carla.id)))?.id, withCarla.id);

    assert.equal(
      (await conversationsFor(basel)).some((item) => item.slug === carla.id),
      false,
      "somebody who never spoke with Carla gets no chat with them"
    );
    assert.equal(await channelFor(basel, peerConversation(basel.id, carla.id)), null, "and cannot start one");
  });
});
