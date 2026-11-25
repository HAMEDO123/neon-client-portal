import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SWIPE_PX, swipeOf } from "../src/lib/swipe";

// Swiping through the photo viewer on a phone (2026-11-25).

describe("a swipe in the photo viewer", () => {
  it("left is the next picture, right the one before", () => {
    assert.equal(swipeOf(-80, 5), 1);
    assert.equal(swipeOf(80, -5), -1);
  });
  it("is not a short move, a tap, or a scroll up and down", () => {
    assert.equal(swipeOf(-(SWIPE_PX - 1), 0), 0);
    assert.equal(swipeOf(0, 0), 0);
    assert.equal(swipeOf(-60, 70), 0);
  });
  it("is wired into the viewer, and a swipe is not also the tap that zooms", () => {
    const viewer = readFileSync(join(process.cwd(), "src", "components", "client", "lightbox.tsx"), "utf8");
    assert.match(viewer, /onTouchStart=\{onTouchStart\}/);
    assert.match(viewer, /onTouchEnd=\{onTouchEnd\}/);
    assert.match(viewer, /tapped\(\(\) => setZoomed/);
  });
});
