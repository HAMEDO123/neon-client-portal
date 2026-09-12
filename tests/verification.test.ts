import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_POLICY,
  describeOutcome,
  gapsFrom,
  isAutomatic,
  outcomeOf,
  questionsFrom,
  stillOpen,
  submissionClosesTask,
  type CriterionCheck,
} from "../src/lib/verification";

function check(overrides: Partial<CriterionCheck> = {}): CriterionCheck {
  return {
    required: "Every room labelled",
    evidence: "The plan shows labels on four rooms",
    verdict: "met",
    gap: null,
    ...overrides,
  };
}

describe("what to do with a claim of finished work", () => {
  it("never accepts when there was nothing to check against", () => {
    assert.equal(outcomeOf([]), "human-review");
    assert.equal(outcomeOf([], { autoAccept: true }), "human-review");
  });

  it("waits for the manager even when everything is shown, unless the policy says otherwise", () => {
    const all = [check(), check({ required: "Dimensions on every wall" })];

    assert.equal(outcomeOf(all), "human-review");
    assert.equal(outcomeOf(all, { autoAccept: true }), "accepted");
    assert.equal(DEFAULT_POLICY.autoAccept, false);
  });

  it("asks for changes when something is missing or half done", () => {
    assert.equal(outcomeOf([check(), check({ verdict: "not-met", gap: "No dimensions anywhere" })]), "changes-requested");
    assert.equal(outcomeOf([check({ verdict: "partly", gap: "Two rooms are unlabelled" })]), "changes-requested");
  });

  it("asks a question when the evidence simply does not settle it", () => {
    assert.equal(outcomeOf([check(), check({ verdict: "cannot-tell", gap: "The photo cuts off the title block" })]), "clarification-required");
  });

  it("says a definite gap before an uncertain one, because it can be acted on", () => {
    const mixed = [
      check({ verdict: "cannot-tell", gap: "Cannot see the scale" }),
      check({ verdict: "not-met", gap: "The balcony is missing" }),
    ];

    assert.equal(outcomeOf(mixed), "changes-requested");
  });

  it("hands the whole thing to a person the moment one criterion needs one", () => {
    const mixed = [
      check({ verdict: "not-met", gap: "Missing" }),
      check({ verdict: "needs-human", gap: "This is a judgement about quality" }),
    ];

    assert.equal(outcomeOf(mixed), "human-review");
    assert.equal(outcomeOf(mixed, { autoAccept: true }), "human-review");
  });
});

describe("what is sent back", () => {
  it("names the specific things to fix, never a general complaint", () => {
    const gaps = gapsFrom([
      check(),
      check({ required: "Dimensions on every wall", verdict: "not-met", gap: "No dimensions anywhere" }),
      check({ required: "Client's changes in", verdict: "partly", gap: "The kitchen change is not there" }),
    ]);

    assert.deepEqual(gaps, [
      { required: "Dimensions on every wall", gap: "No dimensions anywhere" },
      { required: "Client's changes in", gap: "The kitchen change is not there" },
    ]);
  });

  it("still says something useful when nobody wrote the gap down", () => {
    const gaps = gapsFrom([check({ verdict: "not-met", gap: "   " })]);

    assert.equal(gaps.length, 1);
    assert.ok(gaps[0].gap.length > 0);
  });

  it("asks about the evidence, separately from what is missing", () => {
    const checks = [
      check({ required: "Sent to the client", verdict: "cannot-tell", gap: "A screenshot cannot show it was sent" }),
      check({ required: "Dimensions", verdict: "not-met", gap: "None" }),
    ];

    assert.deepEqual(questionsFrom(checks), [
      { required: "Sent to the client", question: "A screenshot cannot show it was sent" },
    ]);
    assert.equal(gapsFrom(checks).length, 1);
  });
});

describe("the rule the whole thing protects", () => {
  it("never lets sending work finish it", () => {
    assert.equal(submissionClosesTask(), false);
  });

  it("acts by itself only on acceptance, and only when allowed", () => {
    assert.equal(isAutomatic("accepted", { autoAccept: true }), true);
    assert.equal(isAutomatic("accepted"), false);
    assert.equal(isAutomatic("changes-requested", { autoAccept: true }), false);
    assert.equal(isAutomatic("human-review", { autoAccept: true }), false);
  });

  it("has a name for each outcome that a person can read", () => {
    assert.equal(describeOutcome("accepted"), "Accepted");
    assert.equal(describeOutcome("changes-requested"), "Changes requested");
    assert.equal(describeOutcome("clarification-required"), "More detail needed");
    assert.equal(describeOutcome("human-review"), "Waiting for the manager");
  });
});

describe("sending it again", () => {
  it("carries forward only what is still open", () => {
    const before = [
      check({ required: "Dimensions", verdict: "not-met", gap: "None" }),
      check({ required: "Labels", verdict: "partly", gap: "Two rooms" }),
      check({ required: "Title block", verdict: "met" }),
    ];
    const now = [check({ required: "Dimensions", verdict: "met" })];

    assert.deepEqual(
      stillOpen(before, now).map((c) => c.required),
      ["Labels"]
    );
  });

  it("does not ask again for something already answered, whatever the spacing", () => {
    const before = [check({ required: "  Dimensions  ", verdict: "not-met", gap: "None" })];
    const now = [check({ required: "dimensions", verdict: "met" })];

    assert.deepEqual(stillOpen(before, now), []);
  });
});
