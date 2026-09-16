import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PINNED,
  REACTIONS,
  isReaction,
  mayPinAnother,
  reactionCount,
  tally,
  toggleOf,
  type ReactionRow,
} from "../src/lib/chat-reactions";

const row = (emoji: string, memberKey: string, memberName = memberKey): ReactionRow => ({
  emoji,
  memberKey,
  memberName,
});

describe("what a row of reactions says", () => {
  it("counts each emoji once, with everybody who gave it", () => {
    const result = tally([row("👍", "wael"), row("👍", "sally"), row("❤️", "amro")], "admin");

    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((one) => [one.emoji, one.count]),
      [
        ["👍", 2],
        ["❤️", 1],
      ]
    );
    assert.deepEqual(result[0].names, ["wael", "sally"]);
  });

  it("puts the most-given first", () => {
    const result = tally([row("❤️", "amro"), row("👍", "wael"), row("👍", "sally")], "admin");
    assert.equal(result[0].emoji, "👍");
  });

  it("breaks a tie the same way every time, so the row never reshuffles", () => {
    const once = tally([row("✅", "amro"), row("👍", "wael")], "admin");
    const again = tally([row("👍", "wael"), row("✅", "amro")], "admin");

    assert.deepEqual(
      once.map((one) => one.emoji),
      again.map((one) => one.emoji)
    );
    // The fixed order decides: 👍 is offered before ✅.
    assert.equal(once[0].emoji, "👍");
  });

  it("knows which ones are mine", () => {
    const result = tally([row("👍", "wael"), row("❤️", "admin", "Manager")], "admin");

    assert.equal(result.find((one) => one.emoji === "👍")?.mine, false);
    assert.equal(result.find((one) => one.emoji === "❤️")?.mine, true);
  });

  it("counts one person's two different reactions separately", () => {
    const result = tally([row("👍", "wael"), row("🙏", "wael")], "admin");
    assert.equal(result.length, 2);
    assert.deepEqual(result.map((one) => one.count), [1, 1]);
  });

  it("still counts an emoji that is no longer offered, and sorts it last", () => {
    // Taking a reaction out of the set must not delete what people said with it.
    const result = tally([row("🦖", "wael"), row("👍", "sally")], "admin");

    assert.equal(result.length, 2);
    assert.equal(result.map((one) => one.emoji).at(-1), "🦖");
    assert.equal(result.find((one) => one.emoji === "🦖")?.count, 1);
  });

  it("says nothing about a message nobody reacted to", () => {
    assert.deepEqual(tally([], "admin"), []);
    assert.equal(reactionCount([]), 0);
  });
});

describe("pressing an emoji", () => {
  it("gives one I have not given", () => {
    assert.equal(toggleOf([row("👍", "wael")], "admin", "👍"), "add");
  });

  it("takes back one that is already mine", () => {
    assert.equal(toggleOf([row("👍", "admin", "Manager")], "admin", "👍"), "remove");
  });

  it("does not confuse my reaction with somebody else's of the same emoji", () => {
    const rows = [row("👍", "wael"), row("❤️", "admin", "Manager")];
    assert.equal(toggleOf(rows, "admin", "👍"), "add");
    assert.equal(toggleOf(rows, "admin", "❤️"), "remove");
  });
});

describe("which emoji are offered", () => {
  it("accepts the six and nothing else", () => {
    for (const emoji of REACTIONS) assert.equal(isReaction(emoji), true);
    assert.equal(isReaction("🦖"), false);
    assert.equal(isReaction(""), false);
    assert.equal(isReaction("👍👍"), false);
  });

  it("offers no duplicates", () => {
    assert.equal(new Set(REACTIONS).size, REACTIONS.length);
  });
});

describe("how many can be pinned", () => {
  it("lets a conversation fill up to the limit", () => {
    assert.equal(mayPinAnother(0), true);
    assert.equal(mayPinAnother(MAX_PINNED - 1), true);
  });

  it("refuses the next one rather than quietly unpinning the oldest", () => {
    assert.equal(mayPinAnother(MAX_PINNED), false);
    assert.equal(mayPinAnother(MAX_PINNED + 1), false);
  });
});
