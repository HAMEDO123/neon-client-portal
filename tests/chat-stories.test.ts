import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  STORY_CAPTION_MAX,
  cleanCaption,
  isStoryLive,
  storyExpiry,
  storyMediaType,
  storyRings,
  type StoryRow,
} from "../src/lib/chat-stories";

const now = new Date("2026-09-29T12:00:00Z");

function story(id: string, authorKey: string, minutesAgo: number, viewed = false, viewCount = 0): StoryRow {
  const createdAt = new Date(now.getTime() - minutesAgo * 60_000);
  return {
    id,
    authorKey,
    authorName: authorKey,
    authorAvatar: `/a/${authorKey}`,
    mediaUrl: `/m/${id}.jpg`,
    mediaType: "image",
    caption: null,
    createdAt,
    expiresAt: storyExpiry(createdAt),
    viewedByViewer: viewed,
    viewCount,
  };
}

describe("stories", () => {
  it("last 24 hours and not a moment longer", () => {
    const posted = new Date("2026-09-28T12:00:00Z");
    assert.equal(storyExpiry(posted).toISOString(), "2026-09-29T12:00:00.000Z");
    assert.equal(isStoryLive(storyExpiry(posted), now), false);
    assert.equal(isStoryLive(new Date(now.getTime() + 1), now), true);
  });

  it("take photos and MP4 video, and nothing else", () => {
    assert.equal(storyMediaType("image/jpeg"), "image");
    assert.equal(storyMediaType("image/png"), "image");
    assert.equal(storyMediaType("video/mp4"), "video");
    assert.equal(storyMediaType("video/quicktime"), null);
    assert.equal(storyMediaType("application/pdf"), null);
    assert.equal(storyMediaType(undefined), null);
  });

  it("keep a caption trimmed and short, and none when empty", () => {
    assert.equal(cleanCaption("  hello "), "hello");
    assert.equal(cleanCaption("   "), null);
    assert.equal(cleanCaption(undefined), null);
    assert.equal(cleanCaption("x".repeat(900))?.length, STORY_CAPTION_MAX);
  });
});

describe("the story bar", () => {
  it("never shows an expired story", () => {
    const { mine, others } = storyRings([story("old", "emp1", 24 * 60 + 1)], "admin", now);
    assert.equal(mine, null);
    assert.deepEqual(others, []);
  });

  it("puts rings with something unseen first, then seen ones, newest first within each", () => {
    const rows = [
      story("a1", "emp1", 300, true),
      story("b1", "emp2", 200, false),
      story("c1", "emp3", 100, true),
      story("d1", "emp4", 400, false),
    ];
    const { others } = storyRings(rows, "admin", now);
    assert.deepEqual(
      others.map((ring) => ring.authorKey),
      ["emp2", "emp4", "emp3", "emp1"]
    );
    assert.deepEqual(
      others.map((ring) => ring.allViewed),
      [false, false, true, true]
    );
  });

  it("plays a ring's stories oldest first, and counts it seen only when every one is", () => {
    const { others } = storyRings([story("new", "emp1", 10, false), story("old", "emp1", 50, true)], "admin", now);
    assert.deepEqual(
      others[0].stories.map((one) => one.id),
      ["old", "new"]
    );
    assert.equal(others[0].allViewed, false);
  });

  it("gives the viewer their own ring apart, seen, and with its view counts", () => {
    const { mine, others } = storyRings([story("m1", "admin", 5, false, 3), story("x", "emp1", 5, false, 7)], "admin", now);
    assert.ok(mine);
    assert.equal(mine.authorKey, "admin");
    assert.equal(mine.allViewed, true);
    assert.equal(mine.stories[0].viewCount, 3);
    // Nobody else's view count is shown to anybody but their author.
    assert.equal(others[0].stories[0].viewCount, null);
  });
});
