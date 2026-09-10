import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { KEYBOARD_THRESHOLD, measureViewport } from "../src/lib/viewport";

// An iPhone 14-sized screen: 844 points tall with nothing covering it.
const SCREEN = 844;

describe("the frame follows the window you can see", () => {
  it("fills the screen when nothing covers it", () => {
    const state = measureViewport({ height: SCREEN, offsetTop: 0 }, SCREEN);
    assert.equal(state.appHeight, SCREEN);
    assert.equal(state.appTop, 0);
    assert.equal(state.keyboardOpen, false);
  });

  it("shrinks to what is left above the keyboard", () => {
    const state = measureViewport({ height: 508, offsetTop: 0 }, SCREEN);
    assert.equal(state.keyboardOpen, true);
    assert.equal(state.keyboardHeight, SCREEN - 508);
    // The bottom of the frame is the top of the keyboard — where the text box sits.
    assert.equal(state.appHeight, 508);
  });

  it("slides with the window when iOS scrolls a focused field into view", () => {
    // The case that sent the chat's text box up and out of sight: the frame
    // stayed at the top of the page while the window slid 280 points down.
    const state = measureViewport({ height: 508, offsetTop: 280 }, SCREEN);
    assert.equal(state.appTop, 280);
    assert.equal(state.appHeight, 508);
  });

  it("keeps the tab bar at the bottom when iOS forgets to slide back", () => {
    // Keyboard gone, window still slid down: pinned to the page, the tab bar
    // would float up the screen by exactly this much.
    const state = measureViewport({ height: SCREEN, offsetTop: 210 }, SCREEN);
    assert.equal(state.keyboardOpen, false);
    assert.equal(state.appTop, 210);
    assert.equal(state.appHeight, SCREEN);
  });
});

describe("telling a keyboard from a toolbar", () => {
  it("does not mistake a collapsing toolbar for a keyboard", () => {
    const state = measureViewport({ height: SCREEN - (KEYBOARD_THRESHOLD - 10), offsetTop: 0 }, SCREEN);
    assert.equal(state.keyboardOpen, false);
    assert.equal(state.keyboardHeight, 0);
  });

  it("learns the full height from the tallest the window has been", () => {
    // A Home Screen app can open slightly short and grow; the first reading
    // must not become the yardstick for what "no keyboard" looks like.
    const first = measureViewport({ height: 800, offsetTop: 0 }, 0);
    const grown = measureViewport({ height: SCREEN, offsetTop: 0 }, first.baseline);
    assert.equal(grown.baseline, SCREEN);
    assert.equal(grown.keyboardOpen, false);
  });

  it("never lowers the full height while the keyboard is up", () => {
    const state = measureViewport({ height: 508, offsetTop: 0 }, SCREEN);
    assert.equal(state.baseline, SCREEN);
  });

  it("measures whole points, and never a negative top", () => {
    const state = measureViewport({ height: 507.6, offsetTop: -0.4 }, SCREEN);
    assert.equal(state.appHeight, 508);
    assert.equal(state.appTop, 0);
  });
});
