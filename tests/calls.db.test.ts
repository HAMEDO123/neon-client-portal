import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { channelFor, type ChatViewer } from "@/lib/chat";
import { peerConversation } from "@/lib/chat-conversations";
import {
  CallError,
  callsFor,
  declineCall,
  heartbeat,
  joinCall,
  leaveCall,
  sendSignals,
  signalsFor,
  startCall,
  sweep,
  sweepStale,
} from "@/lib/call-store";
import { RING_MS, STALE_MS } from "@/lib/calls";

// Calls against a real database: ringing the other person, answering,
// declining, hanging up, ringing out, going quiet; the line each leaves in the
// chat; connection messages reaching only the people in the call; and one call
// at a time per person.
//
// Run with: npm run test:db   (needs the local dev database up)

const PREFIX = "ztest-call-";
const manager: ChatViewer = { type: "ADMIN", id: null, name: "Manager" };

let reachable = false;
let amal: Extract<ChatViewer, { type: "EMPLOYEE" }>;
let basel: Extract<ChatViewer, { type: "EMPLOYEE" }>;
let carla: Extract<ChatViewer, { type: "EMPLOYEE" }>;

async function cleanup() {
  const people = await prisma.employee.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  if (people.length > 0) {
    // Calls, their lines in the chat and their signals go with the channel.
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

async function directWith(employee: { id: string }) {
  const conversation = { kind: "direct" as const, employeeId: employee.id };
  const channel = await channelFor(manager, conversation);
  return { conversation, channelId: channel!.id };
}

async function lineOf(callId: string) {
  const call = await prisma.call.findUniqueOrThrow({ where: { id: callId }, include: { message: true } });
  return { call, line: call.message };
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

describe("a call between two people", () => {
  it("rings the other person, is answered, passes messages only between them, and leaves its length in the chat", async (t) => {
    if (!reachable) return t.skip("no database");

    const { conversation, channelId } = await directWith(amal);
    const { callId, joinedExisting } = await startCall(manager, conversation, channelId, "AUDIO");
    assert.equal(joinedExisting, false);

    const ringing = (await callsFor(amal)).find((call) => call.id === callId);
    assert.ok(ringing, "Amal is rung");
    assert.equal(ringing.status, "RINGING");
    assert.equal(ringing.conversationSlug, "manager");
    assert.equal(ringing.title, "Manager");
    assert.deepEqual(
      ringing.participants.map((part) => [part.memberKey, part.state]).sort(),
      [["admin", "JOINED"], [amal.id, "INVITED"]].sort()
    );
    assert.equal((await callsFor(basel)).some((call) => call.id === callId), false, "nobody else is");

    await joinCall(amal, callId);
    const answered = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
    assert.equal(answered.status, "ACTIVE");
    assert.ok(answered.answeredAt);

    assert.equal(
      await sendSignals(manager, callId, [
        { to: amal.id, type: "description", payload: { description: { type: "offer", sdp: "v=0" } } },
        { to: basel.id, type: "candidates", payload: { candidates: [] } },
      ]),
      1,
      "only to somebody in the call"
    );
    const delivered = await signalsFor(amal.id, 0);
    assert.ok(delivered.some((signal) => signal.callId === callId && signal.fromKey === "admin" && signal.type === "description"));
    await assert.rejects(
      sendSignals(basel, callId, [{ to: amal.id, type: "candidates", payload: {} }]),
      CallError,
      "somebody outside the call cannot send into it"
    );

    assert.equal(await heartbeat(amal, callId), true);

    await leaveCall(manager, callId);
    const { call, line } = await lineOf(callId);
    assert.equal(call.status, "ENDED");
    assert.equal(call.endReason, "completed");
    assert.equal(line?.kind, "CALL");
    assert.match(line?.body ?? "", /^Call ended · \d+:\d{2}$/);
    assert.equal(line?.authorType, "ADMIN");
    assert.equal(await prisma.callSignal.count({ where: { callId } }), 0, "its messages are cleared");
    assert.equal(await heartbeat(amal, callId), false, "and the other side learns it is over");
  });

  it("leaves 'Declined call' when the other person says no", async (t) => {
    if (!reachable) return t.skip("no database");

    const conversation = peerConversation(amal.id, basel.id);
    const channel = await channelFor(amal, conversation);
    const { callId } = await startCall(amal, conversation, channel!.id, "VIDEO");
    await declineCall(basel, callId);

    const { call, line } = await lineOf(callId);
    assert.equal(call.endReason, "declined");
    assert.equal(line?.body, "Declined video call");
    assert.equal(line?.authorId, amal.id, "the line is the caller's");
  });

  it("leaves 'Missed call' when nobody answers in time, and tells the person it rang", async (t) => {
    if (!reachable) return t.skip("no database");

    const { conversation, channelId } = await directWith(basel);
    const { callId } = await startCall(manager, conversation, channelId, "AUDIO");
    const created = await prisma.call.findUniqueOrThrow({ where: { id: callId } });

    // Not yet: the caller is still there and it is still ringing.
    await sweep(callId, created.createdAt.getTime() + 5_000);
    assert.equal((await prisma.call.findUniqueOrThrow({ where: { id: callId } })).status, "RINGING");

    await prisma.callParticipant.updateMany({ where: { callId, memberKey: "admin" }, data: { lastSeenAt: new Date() } });
    await sweep(callId, Date.now() + RING_MS + 1_000);
    const { call, line } = await lineOf(callId);
    assert.equal(call.endReason, "missed");
    assert.equal(line?.body, "Missed call");
    assert.equal(
      await prisma.notification.count({ where: { employeeId: basel.id, dedupeKey: `CALL_MISSED:${callId}:${basel.id}` } }),
      1
    );
  });

  it("ends when one side goes quiet, as a closed tab or a lost signal does", async (t) => {
    if (!reachable) return t.skip("no database");

    const { conversation, channelId } = await directWith(carla);
    const { callId } = await startCall(manager, conversation, channelId, "AUDIO");
    await joinCall(carla, callId);
    await prisma.callParticipant.updateMany({
      where: { callId, memberKey: carla.id },
      data: { lastSeenAt: new Date(Date.now() - STALE_MS - 5_000) },
    });

    await sweepStale();
    const { call } = await lineOf(callId);
    assert.equal(call.status, "ENDED");
    assert.equal(call.endReason, "completed");
  });
});

describe("one call at a time", () => {
  it("joins the call already ringing when the other person calls back at the same moment", async (t) => {
    if (!reachable) return t.skip("no database");

    const conversation = peerConversation(amal.id, carla.id);
    const channel = await channelFor(amal, conversation);
    const first = await startCall(amal, conversation, channel!.id, "AUDIO");
    const second = await startCall(carla, conversation, channel!.id, "AUDIO");

    assert.equal(second.callId, first.callId);
    assert.equal(second.joinedExisting, true);
    assert.equal((await prisma.call.findUniqueOrThrow({ where: { id: first.callId } })).status, "ACTIVE");

    await leaveCall(amal, first.callId);
  });

  it("takes somebody out of their call when they start another", async (t) => {
    if (!reachable) return t.skip("no database");

    const { conversation, channelId } = await directWith(amal);
    const withManager = await startCall(manager, conversation, channelId, "AUDIO");
    await joinCall(amal, withManager.callId);

    const peer = peerConversation(amal.id, basel.id);
    const channel = await channelFor(amal, peer);
    const withBasel = await startCall(amal, peer, channel!.id, "AUDIO");

    const earlier = await prisma.call.findUniqueOrThrow({ where: { id: withManager.callId } });
    assert.equal(earlier.status, "ENDED", "the call with the manager ended as Amal left it");
    const amalsPart = await prisma.callParticipant.findFirstOrThrow({
      where: { callId: withBasel.callId, memberKey: amal.id },
    });
    assert.equal(amalsPart.state, "JOINED");

    await leaveCall(amal, withBasel.callId);
  });
});
