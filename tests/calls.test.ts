import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  RING_MS,
  STALE_MS,
  callDuration,
  callSummary,
  gridFor,
  initiates,
  isPolite,
  isSpeaking,
  mayCallIn,
  memberKeyOf,
  nextSpeaker,
  qualityOf,
  ringsFor,
  sweepCall,
  usableIceServers,
  type SweepInput,
} from "../src/lib/calls";
import { peerConversation, type ChatViewer } from "../src/lib/chat-conversations";

const manager: ChatViewer = { type: "ADMIN", id: null, name: "Manager" };
const wael: ChatViewer = { type: "EMPLOYEE", id: "cmwael00000000000000", name: "Wael" };
const now = Date.parse("2026-09-15T20:00:00Z");
const ago = (ms: number) => new Date(now - ms);

describe("who is in calls, and where", () => {
  it("keys a person the way chat reads do", () => {
    assert.equal(memberKeyOf(manager), "admin");
    assert.equal(memberKeyOf(wael), wael.id);
  });

  it("allows calls in every conversation: the team's group and the private chats", () => {
    assert.equal(mayCallIn({ kind: "direct", employeeId: "cmwael00000000000000" }), true);
    assert.equal(mayCallIn(peerConversation("cmwael00000000000000", "cmsally0000000000000")), true);
    assert.equal(mayCallIn({ kind: "team" }), true);
  });
});

describe("what a call has become", () => {
  const ringing = (overrides: Partial<SweepInput> = {}): SweepInput => ({
    status: "RINGING",
    createdAt: ago(5_000),
    startedByKey: "admin",
    group: false,
    participants: [
      { memberKey: "admin", state: "JOINED", lastSeenAt: ago(1_000) },
      { memberKey: "wael", state: "INVITED", lastSeenAt: null },
    ],
    ...overrides,
  });

  it("keeps ringing while the caller is there and there is time", () => {
    assert.deepEqual(sweepCall(ringing(), now), { gone: [], end: null });
  });

  it("is missed when nobody answers in time, or the caller goes before anybody does", () => {
    assert.deepEqual(sweepCall(ringing({ createdAt: ago(RING_MS + 1) }), now), { gone: [], end: "missed" });
    const callerGone = ringing({
      participants: [
        { memberKey: "admin", state: "JOINED", lastSeenAt: ago(STALE_MS + 1) },
        { memberKey: "wael", state: "INVITED", lastSeenAt: null },
      ],
    });
    assert.deepEqual(sweepCall(callerGone, now), { gone: ["admin"], end: "missed" });
    const hungUp = ringing({
      participants: [
        { memberKey: "admin", state: "LEFT", lastSeenAt: ago(1_000) },
        { memberKey: "wael", state: "INVITED", lastSeenAt: null },
      ],
    });
    assert.equal(sweepCall(hungUp, now).end, "missed");
  });

  it("is declined when everybody asked says no", () => {
    const declined = ringing({
      participants: [
        { memberKey: "admin", state: "JOINED", lastSeenAt: ago(1_000) },
        { memberKey: "wael", state: "DECLINED", lastSeenAt: null },
      ],
    });
    assert.equal(sweepCall(declined, now).end, "declined");
  });

  it("between two people, ends when either leaves or goes quiet", () => {
    const active = (waelSeen: Date, waelState: "JOINED" | "LEFT" = "JOINED"): SweepInput =>
      ringing({
        status: "ACTIVE",
        participants: [
          { memberKey: "admin", state: "JOINED", lastSeenAt: ago(1_000) },
          { memberKey: "wael", state: waelState, lastSeenAt: waelSeen },
        ],
      });
    assert.deepEqual(sweepCall(active(ago(2_000)), now), { gone: [], end: null });
    assert.deepEqual(sweepCall(active(ago(STALE_MS + 1)), now), { gone: ["wael"], end: "completed" });
    assert.equal(sweepCall(active(ago(2_000), "LEFT"), now).end, "completed");
  });

  it("in a group, carries on while anybody is in it", () => {
    const group = ringing({
      status: "ACTIVE",
      group: true,
      participants: [
        { memberKey: "admin", state: "LEFT", lastSeenAt: ago(1_000) },
        { memberKey: "wael", state: "JOINED", lastSeenAt: ago(1_000) },
        { memberKey: "sally", state: "INVITED", lastSeenAt: null },
      ],
    });
    assert.equal(sweepCall(group, now).end, null);
  });

  it("does not count somebody still arriving as gone, and leaves an ended call alone", () => {
    const arriving = ringing({
      status: "ACTIVE",
      participants: [
        { memberKey: "admin", state: "JOINED", lastSeenAt: ago(1_000) },
        { memberKey: "wael", state: "JOINED", lastSeenAt: null },
      ],
    });
    assert.deepEqual(sweepCall(arriving, now), { gone: [], end: null });
    assert.deepEqual(sweepCall(ringing({ status: "ENDED" }), now), { gone: [], end: null });
  });

  it("rings the people asked, until they answer or the time runs out", () => {
    const call = { status: "RINGING" as const, createdAt: ago(1_000) };
    assert.equal(ringsFor(call, "INVITED", now), true);
    assert.equal(ringsFor(call, "JOINED", now), false);
    assert.equal(ringsFor(call, "DECLINED", now), false);
    assert.equal(ringsFor(call, undefined, now), false);
    assert.equal(ringsFor({ ...call, createdAt: ago(RING_MS + 1) }, "INVITED", now), false);
    assert.equal(ringsFor({ ...call, status: "ENDED" }, "INVITED", now), false);
    assert.equal(ringsFor({ ...call, status: "ACTIVE" }, "INVITED", now), true, "a call already going still rings the rest");
  });
});

describe("what a finished call says in the chat", () => {
  it("writes the length the way a phone does", () => {
    assert.equal(callDuration(45), "0:45");
    assert.equal(callDuration(272), "4:32");
    assert.equal(callDuration(3725), "1:02:05");
    assert.equal(callDuration(-3), "0:00");
  });

  it("says missed, declined, or ended with how long it lasted", () => {
    assert.equal(callSummary("AUDIO", "missed", null), "Missed call");
    assert.equal(callSummary("VIDEO", "missed", null), "Missed video call");
    assert.equal(callSummary("AUDIO", "declined", null), "Declined call");
    assert.equal(callSummary("AUDIO", "completed", 272), "Call ended · 4:32");
    assert.equal(callSummary("VIDEO", "completed", 45), "Video call ended · 0:45");
  });
});

describe("two devices finding each other", () => {
  it("has whoever joined later make the first offer, a tie going to the larger key", () => {
    const early = { key: "b", joinedAt: ago(10_000) };
    const late = { key: "a", joinedAt: ago(1_000) };
    assert.equal(initiates(late, early), true);
    assert.equal(initiates(early, late), false);
    const same = ago(5_000);
    assert.equal(initiates({ key: "b", joinedAt: same }, { key: "a", joinedAt: same }), true);
    assert.equal(initiates({ key: "a", joinedAt: same }, { key: "b", joinedAt: same }), false);
  });

  it("makes exactly one of any two polite", () => {
    assert.notEqual(isPolite("admin", "cmwael"), isPolite("cmwael", "admin"));
  });

  it("uses Cloudflare's servers, without the port 53 addresses browsers block", () => {
    const servers = usableIceServers({
      iceServers: [
        { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
        {
          urls: [
            "turn:turn.cloudflare.com:3478?transport=udp",
            "turn:turn.cloudflare.com:53?transport=udp",
            "turns:turn.cloudflare.com:443?transport=tcp",
          ],
          username: "u",
          credential: "c",
        },
        { urls: "https://not-a-server" },
      ],
    });
    assert.deepEqual(servers, [
      { urls: ["stun:stun.cloudflare.com:3478"] },
      {
        urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"],
        username: "u",
        credential: "c",
      },
    ]);
    assert.deepEqual(usableIceServers(null), []);
    assert.deepEqual(usableIceServers({ iceServers: "nope" }), []);
  });
});

describe("the call screen", () => {
  it("lays people out: one, side by side, two-by-two, three-by-two, and wider", () => {
    assert.deepEqual(gridFor(1, false), { columns: 1, rows: 1 });
    assert.deepEqual(gridFor(2, false), { columns: 2, rows: 1 });
    assert.deepEqual(gridFor(2, true), { columns: 1, rows: 2 });
    assert.deepEqual(gridFor(4, true), { columns: 2, rows: 2 });
    assert.deepEqual(gridFor(5, false), { columns: 3, rows: 2 });
    assert.deepEqual(gridFor(6, true), { columns: 2, rows: 3 });
    assert.deepEqual(gridFor(8, false), { columns: 3, rows: 3 });
    assert.deepEqual(gridFor(11, false), { columns: 4, rows: 3 });
    assert.deepEqual(gridFor(11, true), { columns: 3, rows: 4 });
  });

  it("lights the speaking ring above one level and keeps it on down to a lower one", () => {
    assert.equal(isSpeaking(0.03, false), false);
    assert.equal(isSpeaking(0.06, false), true);
    assert.equal(isSpeaking(0.03, true), true);
    assert.equal(isSpeaking(0.01, true), false);
  });

  it("puts the loudest person large, but not before the one shown has had a moment", () => {
    const start = { key: null, since: 0 };
    const first = nextSpeaker(start, { wael: 0.2, sally: 0.1 }, 1_000);
    assert.deepEqual(first, { key: "wael", since: 1_000 });
    assert.deepEqual(nextSpeaker(first, { wael: 0.05, sally: 0.3 }, 1_500), first, "held");
    assert.deepEqual(nextSpeaker(first, { wael: 0.05, sally: 0.3 }, 3_000), { key: "sally", since: 3_000 });
    assert.deepEqual(nextSpeaker(first, { wael: 0.01, sally: 0.01 }, 9_000), first, "silence keeps whoever was shown");
  });

  it("grades a connection from its round trip, loss and jitter", () => {
    assert.equal(qualityOf({ rttMs: 60, lossRatio: 0, jitterMs: 5 }), "good");
    assert.equal(qualityOf({ rttMs: 250, lossRatio: 0.01, jitterMs: 5 }), "fair");
    assert.equal(qualityOf({ rttMs: 80, lossRatio: 0.12, jitterMs: 5 }), "poor");
    assert.equal(qualityOf({ rttMs: null, lossRatio: null, jitterMs: null }), "unknown");
  });
});
