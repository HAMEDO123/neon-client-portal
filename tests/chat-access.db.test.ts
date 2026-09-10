import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import {
  channelFor,
  conversationsFor,
  directChannelKey,
  listMessages,
  recordChatRead,
  type ChatViewer,
} from "@/lib/chat";
import { getEmployeeBadges } from "@/lib/employee-badges";
import { getAdminBadges } from "@/lib/admin-badges";
import { latestCues } from "@/lib/cues";

// Private conversations against a real database: that one employee's private
// chat with the manager cannot be opened by another employee, that its
// messages count as unread — and make a sound — for its one employee only, and
// that the manager has one for every person on the team.
//
// Run with: npm run test:db   (needs the local dev database up)

const PREFIX = "ztest-chat-";
const manager: ChatViewer = { type: "ADMIN", id: null, name: "Manager" };

let reachable = false;
let amal: Extract<ChatViewer, { type: "EMPLOYEE" }>;
let basel: Extract<ChatViewer, { type: "EMPLOYEE" }>;

async function cleanup() {
  const people = await prisma.employee.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  // Messages and read markers go with their channel.
  await prisma.chatChannel.deleteMany({ where: { key: { in: people.map((person) => directChannelKey(person.id)) } } });
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

  const first = await prisma.employee.create({
    data: { name: `${PREFIX}Amal`, email: `${PREFIX}amal@test.local`, active: true, accessRole: "EMPLOYEE" },
  });
  const second = await prisma.employee.create({
    data: { name: `${PREFIX}Basel`, email: `${PREFIX}basel@test.local`, active: true, accessRole: "EMPLOYEE" },
  });
  amal = { type: "EMPLOYEE", id: first.id, name: first.name };
  basel = { type: "EMPLOYEE", id: second.id, name: second.name };
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
      list.map((item) => item.slug),
      ["team", "manager"],
      "an employee has the group and their chat with the manager"
    );
    assert.equal(list[1].unread, 1);
    assert.equal(list[1].last?.body, "Can you call the supplier?");

    await recordChatRead(amal, channel.id);
    assert.equal((await conversationsFor(amal))[1].unread, 0, "reading it clears it");
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
  });
});
