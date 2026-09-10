import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { KEYBOARD_THRESHOLD, MAX_SHORTFALL, measureViewport } from "../src/lib/viewport";

// An iPhone 15-sized screen: 852 points tall, 59 of them the status bar's.
const SCREEN = 852;
const STATUS_BAR = 59;

describe("the frame never runs past what can be seen", () => {
  it("stops where the window does in a Home Screen app, even short of the screen", () => {
    // iOS 26 reports the window a status bar short of an 852-point screen and
    // draws nothing fixed below it: a frame stretched to the screen had its
    // message box cut in half by a blank band.
    const state = measureViewport({ height: SCREEN - STATUS_BAR, offsetTop: 0, fullHeight: SCREEN }, 0);
    assert.equal(state.appHeight, SCREEN - STATUS_BAR);
    assert.ok(state.appTop + state.appHeight <= SCREEN - STATUS_BAR, "the bottom row is on screen");
    assert.equal(state.keyboardOpen, false);
  });

  it("measures how far short it stops, so the last row keeps no room for the home indicator", () => {
    const state = measureViewport({ height: SCREEN - STATUS_BAR, offsetTop: 0, fullHeight: SCREEN }, 0);
    assert.equal(state.shortfall, STATUS_BAR);
  });

  it("ends the frame exactly at the top of the keyboard", () => {
    const keyboard = 336;
    const closed = measureViewport({ height: SCREEN - STATUS_BAR, offsetTop: 0, fullHeight: SCREEN }, 0);
    const open = measureViewport({ height: SCREEN - keyboard, offsetTop: 0, fullHeight: SCREEN }, closed.baseline);

    assert.equal(open.keyboardOpen, true);
    // The message box sits on the keyboard, not a status bar's height under it.
    assert.equal(open.appHeight, SCREEN - keyboard);
  });

  it("never lets the frame run under the keyboard", () => {
    const keyboard = 336;
    const closed = measureViewport({ height: SCREEN - STATUS_BAR, offsetTop: 0, fullHeight: SCREEN }, 0);
    // Were the window short with the keyboard up as well, the frame would stop
    // a little above the keyboard — a gap, never the box hidden under it.
    const reported = SCREEN - STATUS_BAR - keyboard;
    const open = measureViewport({ height: reported, offsetTop: 0, fullHeight: SCREEN }, closed.baseline);

    assert.equal(open.keyboardOpen, true);
    assert.equal(open.appHeight, reported);
  });

  it("fills the screen where the window reports all of it", () => {
    const state = measureViewport({ height: SCREEN, offsetTop: 0, fullHeight: SCREEN }, 0);
    assert.equal(state.shortfall, 0);
    assert.equal(state.appHeight, SCREEN);
  });

  it("changes nothing in a browser tab, whose toolbars really do cover the screen", () => {
    const state = measureViewport({ height: 700, offsetTop: 0 }, 0);
    assert.equal(state.shortfall, 0);
    assert.equal(state.appHeight, 700);
  });

  it("does not mistake a keyboard that shrinks the page for a gap", () => {
    // Android can resize the page itself; the full height then tracks the
    // window, and there is no gap to measure.
    const closed = measureViewport({ height: 800, offsetTop: 0, fullHeight: 800 }, 0);
    const open = measureViewport({ height: 500, offsetTop: 0, fullHeight: 500 }, closed.baseline);
    assert.equal(open.shortfall, 0);
    assert.equal(open.keyboardOpen, true);
    assert.equal(open.appHeight, 500);
  });

  it("never counts more of a gap than a status bar could be", () => {
    // Opened with the keyboard already up, before the full height is known.
    const state = measureViewport({ height: 500, offsetTop: 0, fullHeight: SCREEN }, 0);
    assert.equal(state.shortfall, MAX_SHORTFALL);
    assert.equal(state.appHeight, 500);
  });
});

describe("the frame follows the window you can see", () => {
  it("slides with the window when iOS scrolls a focused field into view", () => {
    const state = measureViewport({ height: 508, offsetTop: 280 }, SCREEN);
    assert.equal(state.appTop, 280);
    assert.equal(state.appHeight, 508);
  });

  it("keeps the tab bar at the bottom when iOS forgets to slide back", () => {
    const state = measureViewport({ height: SCREEN, offsetTop: 210 }, SCREEN);
    assert.equal(state.keyboardOpen, false);
    assert.equal(state.appTop, 210);
  });
});

describe("telling a keyboard from a toolbar", () => {
  it("does not mistake a collapsing toolbar for a keyboard", () => {
    const state = measureViewport({ height: SCREEN - (KEYBOARD_THRESHOLD - 10), offsetTop: 0 }, SCREEN);
    assert.equal(state.keyboardOpen, false);
    assert.equal(state.keyboardHeight, 0);
  });

  it("learns the full height from the tallest the window has been", () => {
    const first = measureViewport({ height: 800, offsetTop: 0 }, 0);
    const grown = measureViewport({ height: SCREEN, offsetTop: 0 }, first.baseline);
    assert.equal(grown.baseline, SCREEN);
    assert.equal(grown.keyboardOpen, false);
  });

  it("never lowers the full height while the keyboard is up", () => {
    assert.equal(measureViewport({ height: 508, offsetTop: 0 }, SCREEN).baseline, SCREEN);
  });

  it("measures whole points, and never a negative top", () => {
    const state = measureViewport({ height: 507.6, offsetTop: -0.4 }, SCREEN);
    assert.equal(state.appHeight, 508);
    assert.equal(state.appTop, 0);
  });
});
