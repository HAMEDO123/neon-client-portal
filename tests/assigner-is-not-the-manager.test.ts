import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canMove, describeMove, needsApproval } from "../src/lib/task-transitions";

// What changes when somebody other than the manager may hand work out.
//
// `canAssignTasks` was written for one person and held by nobody until
// 2026-11-09, when Sally got it. Two things in the week board only became
// wrong at that moment, and both were invisible before it:
//
//   - every move was logged as `actor: "manager"` with no employee id, so the
//     record could not say which of the two people did it;
//   - the move to DONE is approval (`describeMove` says so), and an assigner
//     could make it on their own job — self-approval, which the guard's own
//     documentation says the permission deliberately does not carry.
//
// Neither showed up in a type, a lint or a screen. A manager has no jobs to
// approve — work is only ever handed to an `accessRole: "EMPLOYEE"` row — so
// while the manager was the only assigner there was nothing to catch.

const root = process.cwd();
const action = readFileSync(join(root, "src", "lib", "actions", "assigned-task-actions.ts"), "utf8");

const bodyOf = (name: string) => {
  const start = action.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  return action.slice(start, action.indexOf("\n}", start));
};

describe("the rule being relied on", () => {
  it("calls DONE what it is, so granting it is granting approval", () => {
    assert.equal(describeMove("IN_PROGRESS", "DONE"), "approved");
    assert.equal(needsApproval("DONE"), true);
  });

  it("refuses an employee their own DONE, in words worth showing", () => {
    const move = canMove("IN_PROGRESS", "DONE", "employee");
    assert.equal(move.ok, false);
    assert.match(move.ok ? "" : move.reason, /Only the manager marks work done/);
  });

  it("still lets an assigner run everybody else's board", () => {
    assert.ok(canMove("IN_PROGRESS", "DONE", "manager").ok, "approving somebody else's job");
    assert.ok(canMove("TODO", "IN_PROGRESS", "manager").ok);
    assert.equal(canMove("TODO", "SUBMITTED", "manager").ok, false, "review is still the worker's to enter");
  });
});

describe("ticking one off from the week view", () => {
  const body = bodyOf("setAssignedTaskState");

  it("keeps the identity the guard hands back instead of discarding it", () => {
    assert.match(body, /const staff = await requireTaskAssigner\(\)/);
    assert.match(body, /staff\.type === "EMPLOYEE" \? staff\.id : null/);
  });

  it("needs the owner of the job to decide whose it is", () => {
    assert.match(body, /select: \{ state: true, employeeId: true \}/, "the state alone cannot answer it");
    assert.match(body, /before\.employeeId === actorEmployeeId/);
  });

  it("acts as the employee on its own job and as the manager on everybody else's", () => {
    assert.match(body, /const actor = own \? "employee" : "manager"/);
    assert.match(body, /canMove\(before\.state, state, actor\)/, "the shared table decides, not this action");
  });

  it("writes down who did it", () => {
    assert.match(body, /recordStateChange\(\{[^}]*actor,[^}]*actorEmployeeId[^}]*\}\)/);
    assert.doesNotMatch(body, /actor: "manager"/, "nothing here claims the manager did it");
  });
});
