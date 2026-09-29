import { test } from "node:test";
import assert from "node:assert/strict";
import { mediaWidth } from "../src/lib/media-width";

test("a width rounds up to the next size", () => {
  assert.equal(mediaWidth("100"), 160);
  assert.equal(mediaWidth("160"), 160);
  assert.equal(mediaWidth("391"), 640);
  assert.equal(mediaWidth("1200"), 1600);
});

test("nothing, nonsense or too wide means the original", () => {
  assert.equal(mediaWidth(null), null);
  assert.equal(mediaWidth(""), null);
  assert.equal(mediaWidth("abc"), null);
  assert.equal(mediaWidth("-5"), null);
  assert.equal(mediaWidth("0"), null);
  assert.equal(mediaWidth("5000"), null);
});
