import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { channelFor, getTeamChannel, listMessages, type ChatViewer } from "@/lib/chat";
import { peerConversation } from "@/lib/chat-conversations";
import {
  createChatMeetingRecords,
  meetingListFor,
  meetingMembers,
  meetingSignature,
  meetingSnapshot,
  meetingsStartingBetween,
  setRsvpRecord,
} from "@/lib/chat-meeting-store";

// Meeting cards against a real database: that a meeting is written whole or not
// at all; that the message arrives with its card already drawn; that the live
// stream's signature moves when somebody answers; that the Meetings list shows
// a meeting to the manager and the people asked and to nobody else; that the
// pass which sends reminders finds the right meetings; and that calling it off
// takes the card and every answer with it.
//
// Run with: npm run test:db   (needs the local dev database up)

const PREFIX = "ztest-cmeet-";
const manager: ChatViewer = { type: "ADMIN", id: null, name: "Manager" };

let reachable = false;
let amal: Extract<ChatViewer, { type: "EMPLOYEE" }>;
let basel: Extract<ChatViewer, { type: "EMPLOYEE" }>;
let carla: Extract<ChatViewer, { type: "EMPLOYEE" }>;
let teamId: string;

const inAnHour = () => new Date(Date.now() + 60 * 60_000);

async function cleanup() {
  // The card and every answer go with the message.
  await prisma.chatMessage.deleteMany({ where: { kind: "MEETING", body: { startsWith: PREFIX } } });
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

function meeting(
  title: string,
  asked: { key: string; name: string; color: string | null }[],
  options: { channelId?: string; startsAt?: Date } = {}
) {
  return createChatMeetingRecords({
    channelId: options.channelId ?? teamId,
    authorName: "Manager",
    title: `${PREFIX}${title}`,
    agenda: "Bring the drawings.",
    mode: "ONLINE",
    place: null,
    startsAt: options.startsAt ?? inAnHour(),
    durationMinutes: 30,
    remindMinutes: 10,
    attendees: asked,
  });
}

const asMember = (one: Extract<ChatViewer, { type: "EMPLOYEE" }>) => ({ key: one.id, name: one.name, color: null });

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

describe("a meeting card", () => {
  it("can ask the manager and everyone in the group, the manager and one person in a private chat, and nobody between two employees", async (t) => {
    if (!reachable) return t.skip("no database");

    const team = (await meetingMembers({ kind: "team" })).map((member) => member.key);
    assert.equal(team[0], "admin", "the manager is asked first: they have no employee row");
    assert.ok([amal.id, basel.id, carla.id].every((id) => team.includes(id)));

    assert.deepEqual(
      (await meetingMembers({ kind: "direct", employeeId: amal.id })).map((member) => member.key),
      ["admin", amal.id]
    );
    assert.deepEqual(await meetingMembers(peerConversation(amal.id, basel.id)), []);
  });

  it("arrives in the conversation with its card already drawn, and everybody asked on it", async (t) => {
    if (!reachable) return t.skip("no database");

    const created = await meeting("Villa review", [asMember(amal), asMember(basel)]);
    assert.equal(created.message.kind, "MEETING");
    assert.equal(created.message.body, `${PREFIX}Villa review`, "the title is what the chat list and a lock screen show");
    assert.equal(created.message.meeting?.id, created.meetingId, "the message arrives with its card");
    assert.equal(created.message.meeting?.attendees.length, 2);
    assert.ok(
      created.message.meeting?.attendees.every((one) => one.rsvp === "INVITED"),
      "asked, and not yet answered either way"
    );

    const team = await channelFor(amal, { kind: "team" });
    const seen = (await listMessages(amal, team!.id)).find((message) => message.id === created.message.id);
    assert.equal(seen?.meeting?.title, `${PREFIX}Villa review`, "and in the conversation, drawn");
  });

  it("is written all at once or not at all", async (t) => {
    if (!reachable) return t.skip("no database");

    await assert.rejects(meeting("Half a meeting", [asMember(amal)], { channelId: "nochannelatall00000" }));
    assert.equal(await prisma.chatMessage.count({ where: { body: `${PREFIX}Half a meeting` } }), 0, "no message left behind");
    assert.equal(await prisma.chatMeeting.count({ where: { title: `${PREFIX}Half a meeting` } }), 0, "and no card");
  });

  it("moves the live signature when somebody answers, and stays put when nothing changed", async (t) => {
    if (!reachable) return t.skip("no database");

    const created = await meeting("Site walk", [asMember(amal), asMember(basel)]);
    const first = await meetingSignature(teamId);

    await setRsvpRecord(created.meetingId, amal.id, "ACCEPTED");
    const afterAnswer = await meetingSignature(teamId);
    assert.notEqual(afterAnswer, first, "an answer reaches the open chats");

    assert.equal(await meetingSignature(teamId), afterAnswer, "and nothing moves when nothing changed");

    const snapshot = await meetingSnapshot(teamId);
    assert.ok(snapshot.ids.includes(created.meetingId));
    const drawn = snapshot.meetings.find((one) => one.id === created.meetingId);
    assert.equal(drawn?.attendees.find((one) => one.memberKey === amal.id)?.rsvp, "ACCEPTED");
    assert.equal(drawn?.attendees.find((one) => one.memberKey === basel.id)?.rsvp, "INVITED", "silence stays silence");
  });

  it("is listed for the manager and the people asked, as each of them names its chat, and for nobody else", async (t) => {
    if (!reachable) return t.skip("no database");

    const inGroup = await meeting("Grout choice", [asMember(basel)]);
    const direct = await channelFor(manager, { kind: "direct", employeeId: amal.id });
    const inPrivate = await meeting("Supplier call", [asMember(amal)], { channelId: direct!.id });

    const basels = await meetingListFor(basel);
    assert.ok(basels.some((item) => item.id === inGroup.meetingId && item.conversationSlug === "team" && item.isGroup));
    assert.ok(!basels.some((item) => item.id === inPrivate.meetingId), "not somebody else's private meeting");

    const amals = await meetingListFor(amal);
    const own = amals.find((item) => item.id === inPrivate.meetingId);
    assert.equal(own?.conversationSlug, "manager");
    assert.equal(own?.conversationTitle, "Manager");
    assert.ok(!amals.some((item) => item.id === inGroup.meetingId), "a group meeting Amal was not asked to is not on Amal's list");

    const carlas = await meetingListFor(carla);
    assert.ok(!carlas.some((item) => item.id === inGroup.meetingId || item.id === inPrivate.meetingId));

    const managers = await meetingListFor(manager);
    assert.equal(managers.find((item) => item.id === inPrivate.meetingId)?.conversationSlug, amal.id);
    assert.ok(managers.some((item) => item.id === inGroup.meetingId));
  });

  it("is found by the pass that tells people, only inside the window it asks about", async (t) => {
    if (!reachable) return t.skip("no database");

    const soon = await meeting("Starts soon", [asMember(amal)], { startsAt: new Date(Date.now() + 20 * 60_000) });
    const far = await meeting("Next week", [asMember(amal)], { startsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000) });

    const found = await meetingsStartingBetween(new Date(Date.now() - 60 * 60_000), new Date(Date.now() + 90 * 60_000));
    const ids = found.map((one) => one.id);
    assert.ok(ids.includes(soon.meetingId), "the one about to start");
    assert.ok(!ids.includes(far.meetingId), "and not one a week away");

    const drawn = found.find((one) => one.id === soon.meetingId);
    assert.equal(drawn?.channel.key, "team", "with the chat it lives in, for the link in the notification");
    assert.equal(drawn?.attendees[0].memberKey, amal.id);
  });

  it("goes with its message: the card and every answer", async (t) => {
    if (!reachable) return t.skip("no database");

    const created = await meeting("Called off", [asMember(amal), asMember(carla)]);
    await setRsvpRecord(created.meetingId, carla.id, "DECLINED");
    const before = await meetingSignature(teamId);

    await prisma.chatMessage.delete({ where: { id: created.message.id } });

    assert.equal(await prisma.chatMeeting.count({ where: { id: created.meetingId } }), 0);
    assert.equal(await prisma.chatMeetingAttendee.count({ where: { meetingId: created.meetingId } }), 0);
    assert.notEqual(await meetingSignature(teamId), before, "and the open chats hear that it went");
    assert.ok(!(await meetingSnapshot(teamId)).ids.includes(created.meetingId));
  });
});
