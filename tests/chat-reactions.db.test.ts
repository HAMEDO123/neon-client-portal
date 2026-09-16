import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { channelFor, type ChatViewer } from "@/lib/chat";
import { conversationFromKey, mayOpen, peerConversation } from "@/lib/chat-conversations";
import {
  countPinned,
  messageForAction,
  reactionSignature,
  reactionSnapshot,
  setPinnedRecord,
  toggleReactionRecord,
} from "@/lib/chat-reaction-store";
import { tally } from "@/lib/chat-reactions";

// Reactions and pins against a real database: that pressing an emoji twice
// gives it and takes it back rather than counting to two, that the unique is
// what enforces it rather than a check with a gap in it, that reactions die
// with the message they are about — and that a message in a chat between two
// employees is not reachable by somebody outside it, through the same three
// steps the action itself takes.
//
// Run with: npm run test:db   (needs the local dev database up)

const PREFIX = "ztest-react-";
const manager: ChatViewer = { type: "ADMIN", id: null, name: "Manager" };

let reachable = false;
let amal: Extract<ChatViewer, { type: "EMPLOYEE" }>;
let basel: Extract<ChatViewer, { type: "EMPLOYEE" }>;
let carla: Extract<ChatViewer, { type: "EMPLOYEE" }>;
let channelId: string;

async function cleanup() {
  const people = await prisma.employee.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  if (people.length > 0) {
    await prisma.chatChannel.deleteMany({ where: { OR: people.map((person) => ({ key: { contains: person.id } })) } });
  }
  await prisma.employee.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

async function person(name: string) {
  const row = await prisma.employee.create({
    data: {
      name: `${PREFIX}${name}`,
      email: `${PREFIX}${name.toLowerCase()}@test.local`,
      active: true,
      accessRole: "EMPLOYEE",
    },
  });
  return { type: "EMPLOYEE" as const, id: row.id, name: row.name };
}

/** One message from Amal in the chat she shares with Basel. */
async function say(body: string) {
  return prisma.chatMessage.create({
    data: { channelId, authorType: "EMPLOYEE", authorId: amal.id, authorName: amal.name, kind: "TEXT", body },
    select: { id: true },
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

  channelId = (await channelFor(amal, peerConversation(amal.id, basel.id)))!.id;
});

after(async () => {
  if (reachable) await cleanup();
  await prisma.$disconnect();
});

describe("giving a reaction and taking it back", () => {
  it("adds it the first time and removes it the second", async (t) => {
    if (!reachable) return t.skip("no database");

    const message = await say("Samples are in");

    assert.equal(await toggleReactionRecord(message.id, basel.id, basel.name, "👍"), "added");
    assert.equal(await prisma.chatReaction.count({ where: { messageId: message.id } }), 1);

    assert.equal(await toggleReactionRecord(message.id, basel.id, basel.name, "👍"), "removed");
    assert.equal(await prisma.chatReaction.count({ where: { messageId: message.id } }), 0);
  });

  it("never lets one person give the same emoji twice", async (t) => {
    if (!reachable) return t.skip("no database");

    const message = await say("Coming up");
    await toggleReactionRecord(message.id, basel.id, basel.name, "👍");

    // Two taps landing together: the unique is what decides, not a read
    // followed by a write with a gap between them.
    await assert.rejects(
      prisma.chatReaction.create({ data: { messageId: message.id, memberKey: basel.id, memberName: basel.name, emoji: "👍" } })
    );
    assert.equal(await prisma.chatReaction.count({ where: { messageId: message.id } }), 1);
  });

  it("counts two different emoji from the same person separately", async (t) => {
    if (!reachable) return t.skip("no database");

    const message = await say("Drawings attached");
    await toggleReactionRecord(message.id, basel.id, basel.name, "👍");
    await toggleReactionRecord(message.id, basel.id, basel.name, "🙏");

    const rows = await prisma.chatReaction.findMany({
      where: { messageId: message.id },
      select: { emoji: true, memberKey: true, memberName: true },
    });
    assert.equal(rows.length, 2);
    assert.deepEqual(
      tally(rows, basel.id).map((one) => one.count),
      [1, 1]
    );
  });

  it("lets the manager's key react alongside an employee's", async (t) => {
    if (!reachable) return t.skip("no database");

    const message = await say("Ready for review");
    await toggleReactionRecord(message.id, basel.id, basel.name, "👍");
    await toggleReactionRecord(message.id, "admin", "Manager", "👍");

    const rows = await prisma.chatReaction.findMany({
      where: { messageId: message.id },
      select: { emoji: true, memberKey: true, memberName: true },
    });
    const row = tally(rows, "admin").find((one) => one.emoji === "👍");
    assert.equal(row?.count, 2);
    assert.equal(row?.mine, true, "the manager sees their own in it");
  });

  it("takes reactions with the message they are about", async (t) => {
    if (!reachable) return t.skip("no database");

    const message = await say("Delete me");
    await toggleReactionRecord(message.id, basel.id, basel.name, "❤️");

    await prisma.chatMessage.delete({ where: { id: message.id } });
    assert.equal(await prisma.chatReaction.count({ where: { messageId: message.id } }), 0);
  });
});

describe("what the live stream watches", () => {
  it("moves when a reaction is given, and again when it is taken back", async (t) => {
    if (!reachable) return t.skip("no database");

    const message = await say("Watch this");
    const before = await reactionSignature(channelId);

    await toggleReactionRecord(message.id, basel.id, basel.name, "👀");
    const given = await reactionSignature(channelId);
    assert.notEqual(given, before, "giving one is news");

    await toggleReactionRecord(message.id, basel.id, basel.name, "👀");
    const back = await reactionSignature(channelId);
    assert.notEqual(back, given, "so is taking it back — a count that only ever grows would miss it");
  });

  it("moves when a message is pinned and when it is taken down", async (t) => {
    if (!reachable) return t.skip("no database");

    const message = await say("Pin this");
    const before = await reactionSignature(channelId);

    await setPinnedRecord(message.id, true, basel.id, basel.name);
    const pinned = await reactionSignature(channelId);
    assert.notEqual(pinned, before);

    await setPinnedRecord(message.id, false, basel.id, basel.name);
    assert.notEqual(await reactionSignature(channelId), pinned);
  });

  it("hands over the reactions and the pins of one conversation", async (t) => {
    if (!reachable) return t.skip("no database");

    const message = await say("In the snapshot");
    await toggleReactionRecord(message.id, basel.id, basel.name, "✅");
    await setPinnedRecord(message.id, true, basel.id, basel.name);

    const snapshot = await reactionSnapshot(channelId);
    assert.ok(snapshot.reactions.some((one) => one.messageId === message.id && one.emoji === "✅"));

    const row = snapshot.pinned.find((one) => one.id === message.id);
    assert.ok(row, "the pinned message is in it");
    assert.equal(row.pinnedByName, basel.name, "with the name of whoever pinned it");

    await setPinnedRecord(message.id, false, basel.id, basel.name);
  });
});

describe("pinning", () => {
  it("writes who pinned it, and clears all three when it comes down", async (t) => {
    if (!reachable) return t.skip("no database");

    const message = await say("Keep this in view");

    await setPinnedRecord(message.id, true, "admin", "Manager");
    const up = await prisma.chatMessage.findUniqueOrThrow({
      where: { id: message.id },
      select: { pinnedAt: true, pinnedBy: true, pinnedByName: true },
    });
    assert.ok(up.pinnedAt);
    assert.equal(up.pinnedBy, "admin");
    assert.equal(up.pinnedByName, "Manager");

    await setPinnedRecord(message.id, false, "admin", "Manager");
    const down = await prisma.chatMessage.findUniqueOrThrow({
      where: { id: message.id },
      select: { pinnedAt: true, pinnedBy: true, pinnedByName: true },
    });
    assert.deepEqual(down, { pinnedAt: null, pinnedBy: null, pinnedByName: null }, "no pin left half-written");
  });

  it("counts only its own conversation", async (t) => {
    if (!reachable) return t.skip("no database");

    const elsewhere = (await channelFor(manager, { kind: "direct", employeeId: amal.id }))!;
    const mine = await say("Pinned here");
    const theirs = await prisma.chatMessage.create({
      data: { channelId: elsewhere.id, authorType: "ADMIN", authorName: "Manager", kind: "TEXT", body: "Pinned there" },
      select: { id: true },
    });

    const before = await countPinned(channelId);
    await setPinnedRecord(mine.id, true, basel.id, basel.name);
    await setPinnedRecord(theirs.id, true, "admin", "Manager");

    assert.equal(await countPinned(channelId), before + 1, "the other conversation's pin is not counted here");
    assert.equal(await countPinned(elsewhere.id), 1);

    await setPinnedRecord(mine.id, false, basel.id, basel.name);
  });
});

describe("a message somebody else's conversation holds", () => {
  it("is not reachable by its id, through the same door the action uses", async (t) => {
    if (!reachable) return t.skip("no database");

    const message = await say("Between the two of us");
    const found = await messageForAction(message.id);
    assert.ok(found, "the row is there for whoever may see it");

    // The three steps an action takes with an id it was handed.
    const conversation = conversationFromKey(found.channel.key);
    assert.ok(conversation);
    assert.equal(mayOpen(carla, conversation), false, "Carla is not in it");
    assert.equal(mayOpen(manager, conversation), false, "nor is the manager");
    assert.equal(mayOpen(basel, conversation), true, "Basel is");
  });
});
