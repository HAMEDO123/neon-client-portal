import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canMove, describeMove, needsApproval } from "../src/lib/task-transitions";

// What somebody other than the manager may do once they can hand work out.
//
// `canAssignTasks` was written for one person and held by nobody until
// 2026-11-09, when Sally got it. The owner's rule came in two parts:
//
//   - 2026-11-09: she "keeps receiving tasks from the manager but can assign
//     tasks on employees";
//   - 2026-11-14: she sees what she assigned today "but still can't accept or
//     reject, just see".
//
// So an assigner gives work and watches it. Changing, moving, deleting and
// deciding a job is finished stay the manager's, on everybody's jobs. None of
// this shows in a type, a lint or a build — every refused path still
// typechecks — which is why it is pinned at the source.

const root = process.cwd();
const read = (...path: string[]) => readFileSync(join(root, ...path), "utf8");
const action = read("src", "lib", "actions", "assigned-task-actions.ts");

const sliceFrom = (source: string, marker: string) => {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} exists`);
  return source.slice(start, source.indexOf("\n}", start));
};
const bodyOf = (name: string) => sliceFrom(action, `export async function ${name}(`);

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
});

describe("an assigner hands work out and sees it — nothing after", () => {
  it("refuses an employee and lets the manager through", () => {
    const helper = sliceFrom(action, "function refuseAssigner(");
    assert.match(helper, /if \(staff\.type === "EMPLOYEE"\)/);
    assert.match(helper, /throw new Error/);
  });

  const refused = ["setAssignedTaskState", "updateAssignedTask", "deleteAssignedTask", "moveAssignedTask"];
  for (const name of refused) {
    it(`refuses ${name} to an assigner, before anything is read or written`, () => {
      const body = bodyOf(name);
      assert.match(body, /const staff = await requireTaskAssigner\(\)/, "the guard's identity is kept");
      const guard = body.indexOf("refuseAssigner(staff");
      assert.ok(guard >= 0, "and checked");
      const firstWrite = body.search(/prisma\.assignedTask\.(update|delete|findUnique)/);
      assert.ok(firstWrite === -1 || firstWrite > guard, "before the row is touched");
    });
  }

  it("accepting is refused in words about accepting", () => {
    assert.match(bodyOf("setAssignedTaskState"), /refuseAssigner\(staff, "Accepting or sending back work"\)/);
  });

  it("is still free to hand work out — that is the permission", () => {
    assert.doesNotMatch(bodyOf("createAssignedTask"), /refuseAssigner/);
    assert.doesNotMatch(bodyOf("assignDraftedTasks"), /refuseAssigner/);
  });

  it("the review queue was never theirs", () => {
    const reviews = read("src", "lib", "actions", "submission-actions.ts");
    for (const name of ["approveSubmission", "rejectSubmission"]) {
      const start = reviews.indexOf(`export async function ${name}(`);
      assert.ok(start >= 0, `${name} exists`);
      assert.match(reviews.slice(start, start + 200), /await requireAdmin\(\)/, `${name} is the manager's`);
    }
  });
});

describe("who handed it out is written down", () => {
  it("on both ways of handing work out", () => {
    for (const name of ["createAssignedTask", "assignDraftedTasks"]) {
      const body = bodyOf(name);
      assert.match(body, /const staff = await requireTaskAssigner\(\)/, name);
      assert.match(body, /assignedById: assignedByOf\(staff\)/, name);
    }
  });

  it("as the employee, and null for the manager", () => {
    assert.match(action, /const assignedByOf = \(staff: Staff\) => \(staff\.type === "EMPLOYEE" \? staff\.id : null\)/);
  });
});

describe("what an assigner sees", () => {
  const loader = read("src", "lib", "assigned-tasks.ts");

  it("is their own handing out only, today's and given today", () => {
    const body = sliceFrom(loader, "export async function assignedByToday(");
    assert.match(body, /assignedById: assignerId/);
    assert.match(body, /startDay: \{ lte: day \}, endDay: \{ gte: day \}/, "runs today");
    assert.match(body, /createdAt: \{ gte: since \}/, "or was given today");
  });

  it("on the website, as rows that open nothing", () => {
    const page = read("src", "app", "employee", "(portal)", "tasks", "page.tsx");
    assert.match(page, /assignedByToday\(employee\.id, today, timezone\)/);
    assert.doesNotMatch(page, /assignedTasksForWeek/, "not the team's week");

    const screen = read("src", "components", "tasks", "assign-work.tsx");
    assert.doesNotMatch(screen, /setAssignedTaskState|deleteAssignedTask|moveAssignedTask|updateAssignedTask/);
    assert.match(screen, /task=\{null\}/, "the dialog only ever writes a new one");
  });

  it("in the phone app, the same list, marked read-only", () => {
    const registry = read("src", "lib", "mobile", "registry", "me.ts");
    const body = sliceFrom(registry, '"me/assign/week"');
    assert.match(body, /if \(staff\.type === "EMPLOYEE"\)/);
    assert.match(body, /assignedByToday\(staff\.id, today, timezone\)/);
    assert.match(body, /readOnly: true/);
  });
});
