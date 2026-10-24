import { test } from "node:test";
import assert from "node:assert/strict";
import { spell } from "../src/lib/clock-day";

// The card tells somebody how late they were and how long they were out. It is
// read on a phone, by the person it is about, so it says "2h 55m" rather than
// 175 or 2.92.

test("a length of time reads the way somebody says it", () => {
  assert.equal(spell(175), "2h 55m");
  assert.equal(spell(60), "1h", "no trailing zero minutes");
  assert.equal(spell(40), "40m", "under an hour has no hours");
  assert.equal(spell(215), "3h 35m");
  assert.equal(spell(0), "0m");
});

test("nothing negative ever reaches the screen", () => {
  // Arriving early is not "-20m late": the caller never charges it, and this
  // must not render it either.
  assert.equal(spell(-20), "0m");
});
