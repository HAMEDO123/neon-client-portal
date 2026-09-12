import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  effortLabel,
  isStartable,
  readinessLabel,
  readinessOf,
  readinessReason,
  type TaskFacts,
} from "../src/lib/task-readiness";

const base: TaskFacts = {
  state: "TODO",
  blockedReason: null,
  blockedByName: null,
  dependencies: [],
};

describe("whether a task can be picked up", () => {
  it("is ready when nothing is in its way", () => {
    assert.deepEqual(readinessOf(base), { status: "ready" });
    assert.equal(isStartable(readinessOf(base)), true);
  });

  it("waits on the tasks before it that are not finished", () => {
    const readiness = readinessOf({
      ...base,
      dependencies: [
        { name: "Design approval", done: false },
        { name: "Site visit", done: true },
      ],
    });

    assert.deepEqual(readiness, { status: "waiting", on: ["Design approval"] });
    assert.equal(isStartable(readiness), false);
    assert.equal(readinessLabel(readiness), "Waiting on Design approval");
  });

  it("is ready again the moment the last one finishes, with nothing else written", () => {
    const readiness = readinessOf({ ...base, dependencies: [{ name: "Design approval", done: true }] });
    assert.equal(readiness.status, "ready");
  });

  it("is blocked when somebody wrote down why, and says who can clear it", () => {
    const readiness = readinessOf({
      ...base,
      blockedReason: "  Waiting on the site measurements  ",
      blockedByName: "Wael",
      dependencies: [{ name: "Design approval", done: false }],
    });

    assert.deepEqual(readiness, {
      status: "blocked",
      reason: "Waiting on the site measurements",
      ownerName: "Wael",
    });
    // A written reason beats a dependency: somebody looked and said why, and
    // the reason stays its own string so it can be shown in its own direction.
    assert.deepEqual(readinessReason(readiness), {
      reason: "Waiting on the site measurements",
      who: "Wael",
    });
  });

  it("treats an empty blocker as no blocker", () => {
    assert.equal(readinessOf({ ...base, blockedReason: "   " }).status, "ready");
  });

  it("hands a submitted task to the manager rather than calling it blocked", () => {
    const readiness = readinessOf({
      ...base,
      state: "SUBMITTED",
      blockedReason: "Waiting on measurements",
    });
    assert.deepEqual(readiness, { status: "in-review" });
    assert.equal(readinessLabel(readiness), "Waiting for approval");
  });

  it("calls finished work finished, whatever else is recorded against it", () => {
    const readiness = readinessOf({
      ...base,
      state: "DONE",
      blockedReason: "Waiting on measurements",
      dependencies: [{ name: "Design approval", done: false }],
    });
    assert.deepEqual(readiness, { status: "done" });
  });

  it("counts the tasks rather than listing them when there are several", () => {
    const readiness = readinessOf({
      ...base,
      dependencies: [
        { name: "Design approval", done: false },
        { name: "Material selection", done: false },
      ],
    });
    assert.equal(readinessLabel(readiness), "Waiting on 2 tasks");
    assert.match(readinessReason(readiness)?.reason ?? "", /Design approval, Material selection are finished/);
  });
});

describe("the effort estimate, as a person would say it", () => {
  it("says nothing when nobody has guessed", () => {
    assert.equal(effortLabel(null), null);
    assert.equal(effortLabel(0), null);
    assert.equal(effortLabel(-3), null);
  });

  it("says minutes under an hour and half hours above it", () => {
    assert.equal(effortLabel(0.5), "30 min");
    assert.equal(effortLabel(1), "1 h");
    assert.equal(effortLabel(2.4), "2.5 h");
    assert.equal(effortLabel(8), "8 h");
  });
});
