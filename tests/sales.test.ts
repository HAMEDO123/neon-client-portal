import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SALES_TARGET, salesLine, salesStanding } from "../src/lib/sales";

describe("the monthly sales target", () => {
  it("is three projects", () => {
    assert.equal(DEFAULT_SALES_TARGET, 3);
  });

  it("counts what is left of the month's target", () => {
    assert.deepEqual(salesStanding(0, 3), { sold: 0, target: 3, left: 3, met: false, percent: 0 });
    assert.deepEqual(salesStanding(2, 3), { sold: 2, target: 3, left: 1, met: false, percent: 67 });
    assert.deepEqual(salesStanding(3, 3), { sold: 3, target: 3, left: 0, met: true, percent: 100 });
  });

  it("does not run past full when someone sells more than asked", () => {
    const over = salesStanding(5, 3);
    assert.equal(over.met, true);
    assert.equal(over.left, 0);
    assert.equal(over.percent, 100);
  });

  it("treats no target as nothing to fall short of", () => {
    const none = salesStanding(0, 0);
    assert.equal(none.met, true);
    assert.equal(none.percent, 100);
  });

  it("never counts below nothing", () => {
    assert.equal(salesStanding(-3, 3).sold, 0);
    assert.equal(salesStanding(1, -2).target, 0);
  });
});

describe("what the card says under the bar", () => {
  it("says how many are left", () => {
    assert.equal(salesLine(salesStanding(1, 3)), "2 more to reach the target.");
  });

  it("says when the target is met, and by how much it was beaten", () => {
    assert.equal(salesLine(salesStanding(3, 3)), "Target met.");
    assert.equal(salesLine(salesStanding(4, 3)), "Target met, 1 over.");
  });

  it("says so when nobody set a target", () => {
    assert.equal(salesLine(salesStanding(2, 0)), "No target set.");
  });
});
