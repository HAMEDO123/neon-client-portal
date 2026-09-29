import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { conversationMemberKeys, deliveryOf, othersIn } from "../src/lib/mobile/chat-receipt-rules";

// The phone's WhatsApp ticks. One grey = saved; two grey = it reached
// everybody else; two green = everybody else has read it.

const sentAt = "2026-09-29T10:00:00.000Z";
const before = "2026-09-29T09:59:00.000Z";
const after = "2026-09-29T10:01:00.000Z";

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
  it("is one tick while the other person has not been here since", () => {
    assert.equal(deliveryOf(sentAt, [{ readAt: before, seenAt: before }]), "sent");
    assert.equal(deliveryOf(sentAt, [{ readAt: null, seenAt: null }]), "sent");
  });

  it("is two grey ticks once their app or page was open after it was sent", () => {
    assert.equal(deliveryOf(sentAt, [{ readAt: before, seenAt: after }]), "delivered");
    assert.equal(deliveryOf(sentAt, [{ readAt: null, seenAt: sentAt }]), "delivered");
  });

  it("is two green ticks once they have read the conversation past it", () => {
    assert.equal(deliveryOf(sentAt, [{ readAt: after, seenAt: before }]), "read");
    assert.equal(deliveryOf(sentAt, [{ readAt: sentAt, seenAt: null }]), "read");
  });

  it("turns green in a group only when everybody has read it", () => {
    const everybody = [
      { readAt: after, seenAt: after },
      { readAt: after, seenAt: after },
    ];
    assert.equal(deliveryOf(sentAt, everybody), "read");

    const oneHasOnlyBeenHere = [
      { readAt: after, seenAt: after },
      { readAt: before, seenAt: after },
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
