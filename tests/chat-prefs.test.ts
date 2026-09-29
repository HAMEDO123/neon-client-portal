import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_PREFS, mergePrefs, orderConversations, readPrefsPatch, unmuted } from "../src/lib/chat-prefs";

describe("reading a change to somebody's settings", () => {
  it("takes the three settings, and only real booleans", () => {
    assert.deepEqual(readPrefsPatch({ pinned: true }), { pinned: true });
    assert.deepEqual(readPrefsPatch({ muted: false, favorite: true, other: 1 }), { muted: false, favorite: true });
    assert.deepEqual(readPrefsPatch(undefined), {});
    assert.deepEqual(readPrefsPatch({ pinned: null }), {});
    assert.throws(() => readPrefsPatch({ pinned: "yes" }), /pinned/);
    assert.throws(() => readPrefsPatch([true]), /object/);
    assert.throws(() => readPrefsPatch("pinned"), /object/);
  });

  it("changes only what was asked, over what was there", () => {
    assert.deepEqual(mergePrefs(null, { pinned: true }), { pinned: true, muted: false, favorite: false });
    assert.deepEqual(mergePrefs({ pinned: true, muted: true, favorite: false }, { muted: false }), {
      pinned: true,
      muted: false,
      favorite: false,
    });
    assert.deepEqual(mergePrefs(DEFAULT_PREFS, {}), DEFAULT_PREFS);
  });
});

describe("the list's order", () => {
  const at = (iso: string) => ({ createdAt: new Date(iso) });
  const item = (id: string, pinned: boolean, last: string | null) => ({ id, pinned, last: last ? at(last) : null });

  it("puts pinned first, the most recent of them on top, then the rest by their last message", () => {
    const ordered = orderConversations([
      item("team", false, "2026-09-29T08:00:00Z"),
      item("old-pin", true, "2026-09-20T08:00:00Z"),
      item("new", false, "2026-09-29T09:00:00Z"),
      item("new-pin", true, "2026-09-28T08:00:00Z"),
      item("quiet-pin", true, null),
    ]);
    assert.deepEqual(
      ordered.map((one) => one.id),
      ["new-pin", "old-pin", "quiet-pin", "new", "team"]
    );
  });

  it("keeps conversations nobody has written in yet after the rest, in the order given", () => {
    const ordered = orderConversations([
      item("b", false, null),
      item("a", false, null),
      item("c", false, "2026-09-01T00:00:00Z"),
    ]);
    assert.deepEqual(
      ordered.map((one) => one.id),
      ["c", "b", "a"]
    );
  });
});

describe("muting", () => {
  it("leaves out only the people who muted the conversation", () => {
    const people = [{ id: "a" }, { id: "b", isManager: true }, { id: "c" }];
    const kept = unmuted(people, new Set(["admin", "c"]), (one) => (one.isManager ? "admin" : one.id));
    assert.deepEqual(
      kept.map((one) => one.id),
      ["a"]
    );
  });
});
