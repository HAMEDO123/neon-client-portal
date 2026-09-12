import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  canMove,
  describeMove,
  isWithTheManager,
  needsApproval,
} from "../src/lib/task-transitions";

// The board's five states, read as the studio reads them:
// TODO is pending, IN_PROGRESS is being worked on, SUBMITTED is with the
// manager for review, DONE is approved, TOMORROW is a planning marker.

const allowed = (move: ReturnType<typeof canMove>) => move.ok;
const refusal = (move: ReturnType<typeof canMove>) => (move.ok ? null : move.reason);

describe("what an employee may do", () => {
  it("starts work and puts it back", () => {
    assert.ok(allowed(canMove("TODO", "IN_PROGRESS", "employee")));
    assert.ok(allowed(canMove("IN_PROGRESS", "TODO", "employee")));
  });

  it("never marks its own work done", () => {
    const move = canMove("IN_PROGRESS", "DONE", "employee");

    assert.equal(move.ok, false);
    assert.match(refusal(move) ?? "", /manager/i);
  });

  it("reaches review by sending proof, not by choosing it", () => {
    assert.equal(canMove("IN_PROGRESS", "SUBMITTED", "employee").ok, false);
    assert.ok(allowed(canMove("IN_PROGRESS", "SUBMITTED", "employee", true)));
    assert.match(refusal(canMove("IN_PROGRESS", "SUBMITTED", "employee")) ?? "", /proof/i);
  });

  it("cannot touch work that is already with the manager", () => {
    assert.equal(canMove("SUBMITTED", "IN_PROGRESS", "employee").ok, false);
    assert.equal(canMove("DONE", "IN_PROGRESS", "employee").ok, false);
    assert.equal(canMove("DONE", "SUBMITTED", "employee", true).ok, false);
  });

  it("does not schedule", () => {
    assert.equal(canMove("TODO", "TOMORROW", "employee").ok, false);
  });
});

describe("what the manager may do", () => {
  it("approves, reopens, and sends back for changes", () => {
    assert.ok(allowed(canMove("SUBMITTED", "DONE", "manager")));
    assert.ok(allowed(canMove("SUBMITTED", "IN_PROGRESS", "manager")));
    assert.ok(allowed(canMove("DONE", "IN_PROGRESS", "manager")));
  });

  it("plans a day", () => {
    assert.ok(allowed(canMove("TODO", "TOMORROW", "manager")));
  });

  it("does not put somebody else's work into review on their behalf", () => {
    const move = canMove("IN_PROGRESS", "SUBMITTED", "manager");

    assert.equal(move.ok, false);
    assert.match(refusal(move) ?? "", /doing the work/i);
  });
});

describe("what a job may do", () => {
  it("moves nothing at all: time passing is not evidence", () => {
    // Real moves only: TODO to TODO is refused for going nowhere, by anybody,
    // which says nothing about automation.
    for (const to of ["IN_PROGRESS", "SUBMITTED", "DONE", "TOMORROW"] as const) {
      const move = canMove("TODO", to, "system");
      assert.equal(move.ok, false, `system should not reach ${to}`);
      assert.match(refusal(move) ?? "", /automation/i);
    }

    assert.match(refusal(canMove("IN_PROGRESS", "TODO", "system")) ?? "", /automation/i);
  });

  it("is refused for going nowhere before anything else is considered", () => {
    assert.match(refusal(canMove("TODO", "TODO", "system")) ?? "", /already in that state/i);
  });
});

describe("the record it leaves", () => {
  it("names the move the way a person would", () => {
    assert.equal(describeMove("IN_PROGRESS", "SUBMITTED"), "sent for review");
    assert.equal(describeMove("SUBMITTED", "IN_PROGRESS"), "sent back for changes");
    assert.equal(describeMove("SUBMITTED", "DONE"), "approved");
    assert.equal(describeMove("DONE", "TODO"), "reopened");
    assert.equal(describeMove("TODO", "IN_PROGRESS"), "started");
  });

  it("knows which state needs somebody to approve it, and which is out of the employee's hands", () => {
    assert.equal(needsApproval("DONE"), true);
    assert.equal(needsApproval("SUBMITTED"), false);
    assert.equal(isWithTheManager("SUBMITTED"), true);
    assert.equal(isWithTheManager("DONE"), true);
    assert.equal(isWithTheManager("IN_PROGRESS"), false);
  });
});

describe("moving nowhere", () => {
  it("is refused, whoever asks", () => {
    assert.equal(canMove("TODO", "TODO", "employee").ok, false);
    assert.equal(canMove("DONE", "DONE", "manager").ok, false);
  });
});
