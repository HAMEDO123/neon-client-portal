import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  HEARTBEAT_MS,
  ONLINE_WINDOW_MS,
  TYPING_WINDOW_MS,
  isOnline,
  isReadBy,
  isTyping,
  lastSeenLabel,
} from "../src/lib/presence";

const now = new Date("2026-09-16T12:00:00Z").getTime();
const agoMs = (ms: number) => new Date(now - ms);
const agoMin = (minutes: number) => agoMs(minutes * 60_000);

describe("who counts as here", () => {
  it("counts a fresh heartbeat as here", () => {
    assert.equal(isOnline(agoMs(1_000), now), true);
    assert.equal(isOnline(agoMs(ONLINE_WINDOW_MS - 1_000), now), true);
  });

  it("survives one missed beat, so a phone that slept for a moment is not called away", () => {
    // The window must be longer than the beat, or every skipped beat reads as gone.
    assert.ok(ONLINE_WINDOW_MS > HEARTBEAT_MS * 2);
    assert.equal(isOnline(agoMs(HEARTBEAT_MS + 5_000), now), true);
  });

  it("lets go once the window has passed", () => {
    assert.equal(isOnline(agoMs(ONLINE_WINDOW_MS + 1_000), now), false);
  });

  it("says nothing about somebody it has never seen", () => {
    assert.equal(isOnline(null, now), false);
    assert.equal(isOnline(undefined, now), false);
  });
});

describe("who counts as writing", () => {
  it("needs both a conversation and a fresh keystroke", () => {
    assert.equal(isTyping("chan-1", agoMs(1_000), "chan-1", now), true);
    assert.equal(isTyping(null, agoMs(1_000), "chan-1", now), false, "a stamp with no conversation is not typing");
    assert.equal(isTyping("chan-1", null, "chan-1", now), false, "a conversation with no stamp is not typing");
  });

  it("is only about the conversation being looked at", () => {
    assert.equal(isTyping("chan-2", agoMs(1_000), "chan-1", now), false);
  });

  it("goes quiet once the keystroke is stale", () => {
    assert.equal(isTyping("chan-1", agoMs(TYPING_WINDOW_MS + 1_000), "chan-1", now), false);
  });
});

describe("the line under somebody's name", () => {
  it("says Online while the heartbeat is fresh", () => {
    assert.equal(lastSeenLabel(agoMs(5_000), now), "Online");
  });

  it("says how long ago, in the words the studio would use", () => {
    assert.equal(lastSeenLabel(agoMin(2), now), "Last seen 2 min ago");
    assert.equal(lastSeenLabel(agoMin(90), now), "Last seen 1 h ago");
    assert.equal(lastSeenLabel(agoMin(60 * 25), now), "Last seen yesterday");
    assert.equal(lastSeenLabel(agoMin(60 * 24 * 3), now), "Last seen 3 days ago");
    assert.equal(lastSeenLabel(agoMin(60 * 24 * 30), now), "Last seen a while ago");
  });

  it("says nothing at all about somebody it has never seen, rather than calling them away", () => {
    // Not knowing is not the same as being absent — the whole point of this module.
    assert.equal(lastSeenLabel(null, now), null);
    assert.equal(lastSeenLabel(undefined, now), null);
  });
});

describe("whether a message has been read", () => {
  it("is read once the other person has read past the moment it was sent", () => {
    const sent = agoMin(10);
    assert.equal(isReadBy(sent, agoMin(5)), true, "they opened the chat after it arrived");
    assert.equal(isReadBy(sent, agoMin(20)), false, "their last look was before it arrived");
  });

  it("counts reading at the very same moment as read", () => {
    const sent = agoMin(10);
    assert.equal(isReadBy(sent, sent), true);
  });

  it("claims nothing about somebody who has never opened the conversation", () => {
    assert.equal(isReadBy(agoMin(10), null), false);
    assert.equal(isReadBy(agoMin(10), undefined), false);
  });
});
