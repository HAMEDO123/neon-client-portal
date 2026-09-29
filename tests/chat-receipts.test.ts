import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ONLINE_WINDOW_MS } from "../src/lib/presence";
import { conversationMemberKeys, deliveryOf, othersIn } from "../src/lib/mobile/chat-receipt-rules";

// The phone's WhatsApp ticks. One grey = saved; two grey = it reached
// everybody else; two green = everybody else has read it.

const sentAt = new Date("2026-09-29T10:00:00.000Z");
const at = (secondsFromSend: number) => new Date(sentAt.getTime() + secondsFromSend * 1000).toISOString();
const longBefore = at(-3600);
const after = at(60);

describe("who is in a conversation", () => {
  it("puts the manager in the team, private chats with the manager and every group", () => {
    assert.deepEqual(conversationMemberKeys({ kind: "team" }, { team: ["e1", "e2"] }), ["admin", "e1", "e2"]);
    assert.deepEqual(conversationMemberKeys({ kind: "direct", employeeId: "e1" }), ["admin", "e1"]);
    assert.deepEqual(conversationMemberKeys({ kind: "group", groupId: "g1" }, { groupMembers: ["e3"] }), ["admin", "e3"]);
  });

  it("keeps the manager out of a chat between two employees", () => {
    assert.deepEqual(conversationMemberKeys({ kind: "peer", employeeIds: ["e1", "e2"] }), ["e1", "e2"]);
  });

  it("leaves out the person asking", () => {
    assert.deepEqual(othersIn(["admin", "e1", "e2"], "e1"), ["admin", "e2"]);
    assert.deepEqual(othersIn(["admin", "e1"], "admin"), ["e1"]);
  });
});

describe("the ticks on my message", () => {
  it("is one tick while the other person has not been connected since", () => {
    assert.equal(deliveryOf(sentAt, [{ readAt: longBefore, seenAt: longBefore }]), "sent");
    assert.equal(deliveryOf(sentAt, [{ readAt: null, seenAt: null }]), "sent");
  });

  it("is two grey ticks once their app or page was open after it was sent", () => {
    assert.equal(deliveryOf(sentAt, [{ readAt: longBefore, seenAt: after }]), "delivered");
    assert.equal(deliveryOf(sentAt, [{ readAt: null, seenAt: at(0) }]), "delivered");
  });

  it("is two grey ticks at once when they were online as it was sent, without waiting for their next beat", () => {
    // A beat comes every 30 seconds; somebody who beat 20 seconds ago is here.
    assert.equal(deliveryOf(sentAt, [{ readAt: null, seenAt: at(-20) }]), "delivered");
    assert.equal(deliveryOf(sentAt, [{ readAt: null, seenAt: at(-ONLINE_WINDOW_MS / 1000 + 1) }]), "delivered");
    // Past the green dot's window they were not.
    assert.equal(deliveryOf(sentAt, [{ readAt: null, seenAt: at(-ONLINE_WINDOW_MS / 1000 - 1) }]), "sent");
  });

  it("is two green ticks once they have read the conversation past it", () => {
    assert.equal(deliveryOf(sentAt, [{ readAt: after, seenAt: longBefore }]), "read");
    assert.equal(deliveryOf(sentAt, [{ readAt: at(0), seenAt: null }]), "read");
  });

  it("turns green in a group only when everybody has read it", () => {
    const everybody = [
      { readAt: after, seenAt: after },
      { readAt: after, seenAt: after },
    ];
    assert.equal(deliveryOf(sentAt, everybody), "read");

    const oneHasOnlyBeenHere = [
      { readAt: after, seenAt: after },
      { readAt: longBefore, seenAt: after },
    ];
    assert.equal(deliveryOf(sentAt, oneHasOnlyBeenHere), "delivered");

    const oneNeverCame = [
      { readAt: after, seenAt: after },
      { readAt: null, seenAt: null },
    ];
    assert.equal(deliveryOf(sentAt, oneNeverCame), "sent");
  });

  it("claims nothing when there is nobody else to reach", () => {
    assert.equal(deliveryOf(sentAt, []), "sent");
  });
});
