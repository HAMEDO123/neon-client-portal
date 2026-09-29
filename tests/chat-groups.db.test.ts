import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { channelFor, conversationsFor, parseConversation, type ChatViewer } from "@/lib/chat";
import { groupChannelKey } from "@/lib/chat-conversations";
import {
  changeGroupMembers,
  chatPeople,
  createGroup,
  deleteGroup,
  groupDetail,
  mayOpenNow,
  updateGroup,
} from "@/lib/chat-group-store";
import { setPrefs } from "@/lib/chat-pref-store";
import { postChatMessage } from "@/lib/chat-send";
import { markStoryViewed, storiesFor, storyViewers } from "@/lib/chat-story-store";
import { storyExpiry } from "@/lib/chat-stories";
import { getEmployeeBadges } from "@/lib/employee-badges";
import { latestCues } from "@/lib/cues";
import { getTimezone } from "@/lib/settings";
import { dayKeyIn, instantAt, shiftDayKey } from "@/lib/time";

// Groups, per-person settings, streaks, presence and stories against a real
// database: that a group opens for the manager and its members and nobody
// else, that the list carries each person's own settings and orders by them,
// that a streak is counted from real messages in the studio's calendar, and
// that stories are seen by everybody and counted for their author alone.
//
// Run with: npm run test:db   (needs the local dev database up)

const PREFIX = "ztest-groups-";
const manager: ChatViewer = { type: "ADMIN", id: null, name: "Manager" };

let reachable = false;
let amal: Extract<ChatViewer, { type: "EMPLOYEE" }>;
let basel: Extract<ChatViewer, { type: "EMPLOYEE" }>;
let carla: Extract<ChatViewer, { type: "EMPLOYEE" }>;
const groupIds: string[] = [];

async function cleanup() {
  const people = await prisma.employee.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  if (people.length > 0) {
    await prisma.chatChannel.deleteMany({ where: { OR: people.map((person) => ({ key: { contains: person.id } })) } });
    await prisma.chatPresence.deleteMany({ where: { memberKey: { in: people.map((person) => person.id) } } });
  }
  const groups = await prisma.chatGroup.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  for (const group of groups) {
    await prisma.chatChannel.deleteMany({ where: { key: groupChannelKey(group.id) } });
  }
  await prisma.chatGroup.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.chatStory.deleteMany({ where: { caption: { startsWith: PREFIX } } });
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
  amal = await person("Amal");
  basel = await person("Basel");
  carla = await person("Carla");
});

after(async () => {
  if (reachable) await cleanup();
  await prisma.$disconnect();
});

describe("groups", () => {
  it("open for the manager and their members, and nobody else", async (t) => {
    if (!reachable) return t.skip("no database");

    const made = await createGroup({ name: `${PREFIX}Site`, memberIds: [amal.id, basel.id], photo: null });
    groupIds.push(made.groupId);
    assert.equal(made.slug, `g-${made.groupId}`);

    const conversation = parseConversation(made.slug, amal)!;
    assert.equal((await channelFor(amal, conversation))?.key, groupChannelKey(made.groupId));
    assert.equal((await channelFor(manager, conversation))?.key, groupChannelKey(made.groupId));
    assert.equal(await channelFor(carla, conversation), null, "Carla is not in it");
    assert.equal(await mayOpenNow(carla, conversation), false);
    assert.equal(await mayOpenNow(basel, conversation), true);

    const amals = await conversationsFor(amal);
    const row = amals.find((item) => item.slug === made.slug);
    assert.ok(row, "Amal has it in her list");
    assert.equal(row.isGroup, true);
    assert.equal(row.memberCount, 3, "two members and the manager");
    assert.equal(row.streak, null);
    assert.equal(row.online, null);
    assert.ok(!(await conversationsFor(carla)).some((item) => item.slug === made.slug), "Carla does not");
    assert.ok((await conversationsFor(manager)).some((item) => item.slug === made.slug), "the manager does");

    const detail = await groupDetail(amal, made.slug);
    assert.equal(detail?.members.length, 2);
    assert.equal(detail?.canManage, false);
    assert.equal(await groupDetail(carla, made.slug), null);
    assert.equal((await groupDetail(manager, made.slug))?.canManage, true);
  });

  it("follow their members as the manager changes them, and are renamed everywhere", async (t) => {
    if (!reachable) return t.skip("no database");
    const groupId = groupIds[0];
    const conversation = { kind: "group" as const, groupId };

    await changeGroupMembers(groupId, { add: [carla.id], remove: [basel.id] });
    assert.ok(await channelFor(carla, conversation), "Carla is in now");
    assert.equal(await channelFor(basel, conversation), null, "Basel is out");
    await assert.rejects(changeGroupMembers(groupId, { add: ["cmnobody000000000000"], remove: [] }), /not on the team/);

    await updateGroup(groupId, { name: `${PREFIX}Renamed` });
    const channel = await prisma.chatChannel.findUnique({ where: { key: groupChannelKey(groupId) } });
    assert.equal(channel?.name, `${PREFIX}Renamed`);
  });

  it("count and sound for their members, not for somebody muted, and never for somebody outside", async (t) => {
    if (!reachable) return t.skip("no database");
    const groupId = groupIds[0];
    const channel = (await channelFor(manager, { kind: "group", groupId }))!;

    const amalBefore = await getEmployeeBadges(amal.id);
    const baselBefore = await getEmployeeBadges(basel.id);
    const baselCues = await latestCues(basel);
    const message = await prisma.chatMessage.create({
      data: { channelId: channel.id, authorType: "ADMIN", authorName: "Manager", kind: "TEXT", body: "Site at 10" },
    });

    assert.equal((await getEmployeeBadges(amal.id)).unreadChat - amalBefore.unreadChat, 1);
    assert.equal((await getEmployeeBadges(basel.id)).unreadChat - baselBefore.unreadChat, 0);
    assert.ok((await latestCues(amal)).messages >= message.createdAt.getTime(), "Amal hears it");
    assert.equal((await latestCues(basel)).messages, baselCues.messages, "Basel, who is out, does not");

    // Carla mutes it: no sound, but it still counts as unread.
    const cuesBefore = await latestCues(carla);
    await setPrefs(carla.id, channel.id, { muted: true });
    await prisma.chatMessage.create({
      data: { channelId: channel.id, authorType: "EMPLOYEE", authorId: amal.id, authorName: amal.name, kind: "TEXT", body: "On my way" },
    });
    assert.ok((await latestCues(carla)).messages <= Math.max(cuesBefore.messages, message.createdAt.getTime()));
    const carlas = await conversationsFor(carla);
    const row = carlas.find((item) => item.slug === `g-${groupId}`);
    assert.equal(row?.muted, true);
    assert.ok((row?.unread ?? 0) >= 1, "muting leaves the unread count alone");
  });

  it("tell their other members about a message, except somebody who muted it", async (t) => {
    if (!reachable) return t.skip("no database");
    const made = await createGroup({ name: `${PREFIX}Push`, memberIds: [amal.id, basel.id, carla.id], photo: null });
    const conversation = { kind: "group" as const, groupId: made.groupId };
    const channel = (await channelFor(amal, conversation))!;
    await setPrefs(basel.id, channel.id, { muted: true });

    const message = await postChatMessage(amal, conversation, channel.id, { kind: "TEXT", body: "Pushing" });

    // Telling people runs on its own after the message is written.
    const told = async (id: string) =>
      prisma.notification.count({ where: { employeeId: id, dedupeKey: { contains: message.id } } });
    for (let i = 0; i < 40 && (await told(carla.id)) === 0; i++) await new Promise((done) => setTimeout(done, 50));

    assert.equal(await told(carla.id), 1, "Carla is told");
    assert.equal(await told(basel.id), 0, "Basel muted it");
    assert.equal(await told(amal.id), 0, "nobody hears their own words");
    await deleteGroup(made.groupId);
  });

  it("are deleted with their conversation", async (t) => {
    if (!reachable) return t.skip("no database");
    const groupId = groupIds[0];
    await deleteGroup(groupId);
    assert.equal(await prisma.chatChannel.findUnique({ where: { key: groupChannelKey(groupId) } }), null);
    assert.equal(await channelFor(manager, { kind: "group", groupId }), null);
    assert.equal(await mayOpenNow(manager, { kind: "group", groupId }), false);
  });
});

describe("the list", () => {
  it("puts what this person pinned first, and nobody else's list moves", async (t) => {
    if (!reachable) return t.skip("no database");
    const withBasel = (await channelFor(amal, parseConversation(basel.id, amal)!))!;
    await setPrefs(amal.id, withBasel.id, { pinned: true, favorite: true });

    const amals = await conversationsFor(amal);
    assert.equal(amals[0].slug, basel.id);
    assert.equal(amals[0].pinned, true);
    assert.equal(amals[0].favorite, true);
    const basels = await conversationsFor(basel);
    assert.equal(basels.find((item) => item.slug === amal.id)?.pinned, false);
  });

  it("counts a streak from real messages, in the studio's calendar", async (t) => {
    if (!reachable) return t.skip("no database");
    const channel = (await channelFor(amal, parseConversation(carla.id, amal)!))!;
    const timeZone = await getTimezone();
    const today = dayKeyIn(timeZone);

    // Both wrote on each of the two days before today, and a call's line
    // yesterday does not count for anybody. Nobody has written today yet.
    for (const back of [2, 1]) {
      const day = shiftDayKey(today, -back);
      for (const who of [amal, carla]) {
        await prisma.chatMessage.create({
          data: {
            channelId: channel.id,
            authorType: "EMPLOYEE",
            authorId: who.id,
            authorName: who.name,
            kind: "TEXT",
            body: "hi",
            createdAt: instantAt(day, "12:00", timeZone)!,
          },
        });
      }
    }

    const row = (await conversationsFor(amal)).find((item) => item.slug === carla.id);
    assert.deepEqual(row?.streak, { count: 2, atRisk: true });
    assert.equal(row?.memberCount, null);
    assert.equal(row?.online, false, "never seen reads as not online");

    await prisma.chatPresence.create({ data: { memberKey: carla.id, lastSeenAt: new Date() } });
    assert.equal((await conversationsFor(amal)).find((item) => item.slug === carla.id)?.online, true);
  });
});

describe("stories", () => {
  it("are seen by everybody, and counted for their author alone", async (t) => {
    if (!reachable) return t.skip("no database");
    const createdAt = new Date();
    const story = await prisma.chatStory.create({
      data: {
        authorKey: amal.id,
        authorName: amal.name,
        authorId: amal.id,
        mediaUrl: "/uploads/chat/stories/test.jpg",
        mediaType: "image",
        caption: `${PREFIX}hello`,
        createdAt,
        expiresAt: storyExpiry(createdAt),
      },
    });
    await prisma.chatStory.create({
      data: {
        authorKey: basel.id,
        authorName: basel.name,
        authorId: basel.id,
        mediaUrl: "/uploads/chat/stories/old.jpg",
        mediaType: "image",
        caption: `${PREFIX}expired`,
        createdAt: new Date(Date.now() - 25 * 3600_000),
        expiresAt: new Date(Date.now() - 3600_000),
      },
    });

    const seenByCarla = await storiesFor(carla);
    const ring = seenByCarla.others.find((one) => one.authorKey === amal.id);
    assert.ok(ring, "Carla sees Amal's story");
    assert.equal(ring.allViewed, false);
    assert.equal(ring.stories[0].viewCount, null);
    assert.ok(!seenByCarla.others.some((one) => one.authorKey === basel.id), "an expired story is never shown");

    await markStoryViewed(carla, story.id);
    await markStoryViewed(carla, story.id);
    await markStoryViewed(manager, story.id);
    assert.equal((await storiesFor(carla)).others.find((one) => one.authorKey === amal.id)?.allViewed, true);

    const own = await storiesFor(amal);
    assert.equal(own.mine?.stories[0].viewCount, 2, "Carla once, however often, and the manager");
    const viewers = await storyViewers(story.id);
    assert.deepEqual(viewers.map((one) => one.key).sort(), [carla.id, "admin"].sort());
  });

  it("lists who a group or a new chat can include", async (t) => {
    if (!reachable) return t.skip("no database");
    const forManager = await chatPeople(manager);
    assert.ok(forManager.some((one) => one.id === amal.id));
    assert.ok(!forManager.some((one) => one.id === "manager"));
    const forAmal = await chatPeople(amal);
    assert.equal(forAmal[0].id, "manager");
    assert.ok(!forAmal.some((one) => one.id === amal.id), "not herself");
  });
});
