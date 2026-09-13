import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  effectiveDetail,
  inheritHours,
  inheritText,
  linesOf,
  mayAutoAccept,
  policyFor,
  summaryOf,
} from "../src/lib/task-types";
import { outcomeOf, type CriterionCheck } from "../src/lib/verification";

// The standard lives on the step; the cell keeps the right to differ. These
// tests pin the two ways that goes wrong: a blank box read as a deliberate
// "none", and a switch that would accept work nobody wrote a test for.

describe("what applies to one cell", () => {
  const step = {
    deliverable: "The render, 3000px, as a JPG",
    acceptance: "Lighting matches the reference\nFurniture from the approved list",
    estimateHours: 3,
  };

  it("prefers what was written on the cell", () => {
    const detail = effectiveDetail({ deliverable: "Two renders, not one", acceptance: null, estimateHours: 5 }, step);

    assert.equal(detail.deliverable.value, "Two renders, not one");
    assert.equal(detail.deliverable.from, "cell");
    assert.equal(detail.estimateHours.value, 5);
    assert.equal(detail.estimateHours.from, "cell");
  });

  it("falls back to the step, and says that is where it came from", () => {
    const detail = effectiveDetail({ deliverable: null, acceptance: null, estimateHours: null }, step);

    assert.equal(detail.acceptance.value, step.acceptance);
    assert.equal(detail.acceptance.from, "step");
    assert.equal(detail.estimateHours.value, 3);
    assert.equal(detail.estimateHours.from, "step");
  });

  it("treats an emptied box as nothing written, not as a deliberate none", () => {
    // The trap: opening the acceptance field on a cell, clearing it and saving
    // must not turn the check off for that cell.
    const detail = effectiveDetail({ deliverable: "   ", acceptance: "\n\n", estimateHours: 0 }, step);

    assert.equal(detail.deliverable.from, "step");
    assert.equal(detail.acceptance.from, "step");
    assert.equal(detail.estimateHours.value, 3);
  });

  it("has nothing to say when neither has anything", () => {
    const detail = effectiveDetail(null, null);

    assert.deepEqual(detail.deliverable, { value: null, from: null });
    assert.deepEqual(detail.estimateHours, { value: null, from: null });
  });

  it("refuses hours that are not hours", () => {
    assert.equal(inheritHours(-2, 3).value, 3);
    assert.equal(inheritHours(Number.NaN, 3).value, 3);
    assert.equal(inheritHours(0, 0).value, null);
    assert.equal(inheritText("", "").value, null);
  });
});

describe("reading a written list", () => {
  it("strips the bullets and numbers people type", () => {
    const list = linesOf("- Lighting matches\n2. Furniture approved\n• Files named right");

    assert.deepEqual(list, ["Lighting matches", "Furniture approved", "Files named right"]);
  });

  it("ignores blank lines and stray single characters", () => {
    assert.deepEqual(linesOf("One thing\n\n-\n   \nAnother thing"), ["One thing", "Another thing"]);
  });

  it("caps a very long list rather than handing over all of it", () => {
    const many = Array.from({ length: 40 }, (_, index) => `Criterion ${index}`).join("\n");

    assert.equal(linesOf(many).length, 12);
    assert.equal(linesOf(many, 3).length, 3);
  });
});

describe("accepting work without a person looking", () => {
  it("is off unless somebody turned it on", () => {
    assert.equal(mayAutoAccept({ autoAccept: false, acceptance: "Lighting matches\nFiles named right" }), false);
    assert.equal(mayAutoAccept(null), false);
  });

  it("is refused when nobody wrote what finished means, switch or no switch", () => {
    assert.equal(mayAutoAccept({ autoAccept: true, acceptance: null }), false);
    assert.equal(mayAutoAccept({ autoAccept: true, acceptance: "   " }), false);

    // What to hand in is not what makes it right, so it does not qualify.
    assert.equal(mayAutoAccept({ autoAccept: true, acceptance: null, deliverable: "The render as a JPG" }), false);
  });

  it("is allowed only with the switch on and something to check", () => {
    assert.equal(mayAutoAccept({ autoAccept: true, acceptance: "Lighting matches the reference" }), true);
  });

  it("reaches the outcome through the policy, so the guard actually bites", () => {
    const allShown: CriterionCheck[] = [
      { required: "Lighting matches", evidence: "The render shows it", verdict: "met", gap: null },
    ];

    // Switch on, criteria written: the platform may settle it.
    assert.equal(outcomeOf(allShown, policyFor({ autoAccept: true, acceptance: "Lighting matches" })), "accepted");

    // Switch on, nothing written: it waits for the manager instead.
    assert.equal(outcomeOf(allShown, policyFor({ autoAccept: true, acceptance: null })), "human-review");
  });
});

describe("what a step's standard amounts to", () => {
  it("counts only what is really there", () => {
    const parts = summaryOf({
      acceptance: "Lighting matches\nFurniture approved",
      checklist: "Open the file\nCheck the camera\nRender",
      evidence: "A screenshot of the render settings",
      estimateHours: 3,
      autoAccept: false,
      reviewerId: null,
    });

    assert.deepEqual(parts, ["2 checks", "3-point checklist", "proof required", "3h"]);
  });

  it("says nothing at all about a step nobody has filled in", () => {
    assert.deepEqual(summaryOf({}), []);
    assert.deepEqual(summaryOf(null), []);
  });

  it("mentions automatic acceptance only when it would really happen", () => {
    assert.equal(summaryOf({ autoAccept: true, acceptance: null }).includes("accepted automatically"), false);
    assert.equal(
      summaryOf({ autoAccept: true, acceptance: "Lighting matches" }).includes("accepted automatically"),
      true
    );
  });
});
