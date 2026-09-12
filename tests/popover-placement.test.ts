import assert from "node:assert/strict";
import test from "node:test";
import { GAP, MARGIN, MIN_PANEL_HEIGHT, placePanel, type PlacementInput } from "../src/lib/popover-placement";

// A window the size of a laptop's, and a trigger the size of the little
// calendar button in the corner of a board cell.
const VIEWPORT = { width: 1440, height: 900 };

function at(top: number, extra: Partial<PlacementInput> = {}): PlacementInput {
  return {
    trigger: { top, bottom: top + 14, left: 600, width: 14 },
    panel: { width: 272, height: 700 },
    viewport: VIEWPORT,
    align: "end",
    ...extra,
  };
}

test("hangs under the trigger when the whole form fits there", () => {
  const box = placePanel(at(100, { panel: { width: 272, height: 300 } }));

  assert.equal(box.top, 114 + GAP);
  assert.ok(box.maxHeight >= 300, "capped above the height it wanted");
  assert.ok(box.top + box.maxHeight <= VIEWPORT.height - MARGIN);
});

test("goes above the trigger when there is no room below but room over it", () => {
  // 700 tall, opened from a cell near the bottom: 300 below, 780 above.
  const box = placePanel(at(790, { panel: { width: 272, height: 700 } }));

  assert.equal(box.top + 700 + GAP, 790, "its bottom edge sits a gap above the trigger");
  assert.ok(box.top >= MARGIN);
});

test("takes the roomier side and scrolls when neither side fits it whole", () => {
  const box = placePanel(at(500, { panel: { width: 272, height: 700 } }));

  // 378 below, 488 above — so above, capped, and scrolling inside itself.
  assert.equal(box.top, MARGIN);
  assert.ok(box.maxHeight < 700, "capped so it scrolls");
  assert.ok(box.maxHeight >= MIN_PANEL_HEIGHT);
});

test("covers the window when the trigger leaves room nowhere", () => {
  const box = placePanel({
    trigger: { top: 150, bottom: 164, left: 100, width: 14 },
    panel: { width: 272, height: 700 },
    viewport: { width: 1440, height: 320 },
    align: "end",
  });

  assert.equal(box.top, MARGIN);
  assert.equal(box.maxHeight, 320 - MARGIN * 2);
});

test("never runs off the bottom of the window, wherever it is opened from", () => {
  for (let top = 0; top <= VIEWPORT.height - 14; top += 7) {
    const box = placePanel(at(top));
    assert.ok(box.top >= 0, `top ${box.top} above the window at trigger ${top}`);
    assert.ok(
      box.top + box.maxHeight <= VIEWPORT.height - MARGIN + 0.001,
      `bottom ${box.top + box.maxHeight} past the window at trigger ${top}`
    );
  }
});

test("is always capped, so a form taller than its room scrolls", () => {
  for (let top = 0; top <= VIEWPORT.height - 14; top += 7) {
    const box = placePanel(at(top));
    assert.ok(box.maxHeight > 0 && box.maxHeight <= VIEWPORT.height);
  }
});

test("lines its right edge up with the trigger's when aligned to the end", () => {
  const box = placePanel(at(100, { trigger: { top: 100, bottom: 114, left: 600, width: 14 } }));

  assert.equal(box.left + 272, 600 + 14);
});

test("centres on the trigger, and starts at it, on the other alignments", () => {
  const trigger = { top: 100, bottom: 114, left: 600, width: 14 };

  assert.equal(placePanel(at(100, { trigger, align: "start" })).left, 600);
  assert.equal(placePanel(at(100, { trigger, align: "center" })).left, 600 + 7 - 136);
});

test("is pushed back inside the window at either edge", () => {
  const left = placePanel(at(100, { trigger: { top: 100, bottom: 114, left: 2, width: 14 }, align: "start" }));
  assert.equal(left.left, MARGIN);

  const right = placePanel(at(100, { trigger: { top: 100, bottom: 114, left: 1430, width: 14 }, align: "start" }));
  assert.equal(right.left, VIEWPORT.width - 272 - MARGIN);
});
