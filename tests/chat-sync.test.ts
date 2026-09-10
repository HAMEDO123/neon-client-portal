import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isPending, mergeIncoming, pendingId, reconcile, type Syncable } from "../src/lib/chat-sync";

type M = Syncable & { author: string };

const msg = (id: string, author: string, body: string | null, extra: Partial<M> = {}): M => ({
  id,
  author,
  kind: "TEXT",
  body,
  ...extra,
});

const mine = (message: M) => message.author === "me";

describe("a sent message appears at once", () => {
  it("swaps the pending copy for the saved message, in place", () => {
    const current = [msg("a", "sally", "hi"), msg("pending-1", "me", "on my way", { status: "sending" }), msg("b", "wael", "ok")];
    const next = reconcile(current, "pending-1", msg("real-1", "me", "on my way"));
    assert.deepEqual(
      next.map((m) => m.id),
      ["a", "real-1", "b"]
    );
    assert.equal(next[1].status, undefined);
  });

  it("does not show it twice when the stream got there first", () => {
    const current = [msg("pending-1", "me", "on my way", { status: "sending" }), msg("real-1", "me", "on my way")];
    const next = reconcile(current, "pending-1", msg("real-1", "me", "on my way"));
    assert.deepEqual(
      next.map((m) => m.id),
      ["real-1"]
    );
  });

  it("removes the copy when nothing was saved", () => {
    assert.deepEqual(reconcile([msg("pending-1", "me", "", { status: "sending" })], "pending-1", null), []);
  });
});

describe("messages arriving on the live stream", () => {
  it("lets our own message take the place of its pending copy", () => {
    const current = [msg("pending-1", "me", "on my way", { status: "sending" })];
    const next = mergeIncoming(current, [msg("real-1", "me", "on my way")], mine);
    assert.deepEqual(
      next.map((m) => m.id),
      ["real-1"]
    );
  });

  it("adds everybody else's", () => {
    const next = mergeIncoming([msg("a", "sally", "hi")], [msg("b", "wael", "hello")], mine);
    assert.deepEqual(
      next.map((m) => m.id),
      ["a", "b"]
    );
  });

  it("ignores a message it already has", () => {
    const next = mergeIncoming([msg("a", "sally", "hi")], [msg("a", "sally", "hi")], mine);
    assert.equal(next.length, 1);
  });

  it("matches photos in the order they were sent", () => {
    const current = [
      msg("pending-1", "me", null, { kind: "IMAGE", status: "sending" }),
      msg("pending-2", "me", null, { kind: "IMAGE", status: "sending" }),
    ];
    const next = mergeIncoming(current, [msg("real-1", "me", null, { kind: "IMAGE" })], mine);
    assert.deepEqual(
      next.map((m) => m.id),
      ["real-1", "pending-2"]
    );
  });

  it("marks its own copies so they can be told apart", () => {
    assert.equal(isPending(pendingId()), true);
    assert.equal(isPending("cmtv4qfkd0000eguv1k5772i7"), false);
  });
});
