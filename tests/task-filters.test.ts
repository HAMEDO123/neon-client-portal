import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { TASK_FILTERS, countByFilter, isLate, matchesFilter, readTaskFilter } from "../src/lib/task-filters";

// Which of somebody's tasks a list shows: in progress, sent for review, late,
// done. "Late" is the one that decides what a person is told they are behind
// on, so it is the one pinned hardest.

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");

describe("late", () => {
  const today = "2026-10-10";

  it("is a day that has gone, never the day itself", () => {
    assert.equal(isLate("TODO", "2026-10-09", today), true);
    assert.equal(isLate("IN_PROGRESS", "2026-09-30", today), true);
    // Due today is not late, however late in the day it is — the card says
    // "Due today" until midnight, and the filter must not disagree with it.
    assert.equal(isLate("TODO", "2026-10-10", today), false);
    assert.equal(isLate("TODO", "2026-10-11", today), false);
  });

  it("stops at approval, not at sending", () => {
    // Sent in but not approved: the card goes on saying "2 days late", and a
    // filter that dropped it would hide the very thing waiting on the manager.
    assert.equal(isLate("SUBMITTED", "2026-10-08", today), true);
    assert.equal(isLate("DONE", "2026-10-01", today), false);
  });

  it("cannot be said of work with no date", () => {
    assert.equal(isLate("TODO", null, today), false);
    assert.equal(isLate("IN_PROGRESS", undefined, today), false);
    assert.equal(isLate("TODO", "", today), false);
  });
});

describe("the filters", () => {
  const items = [
    { state: "TODO", late: false },
    { state: "TODO", late: true },
    { state: "TOMORROW", late: false },
    { state: "IN_PROGRESS", late: false },
    { state: "IN_PROGRESS", late: true },
    { state: "SUBMITTED", late: false },
    { state: "SUBMITTED", late: true },
    { state: "DONE", late: false },
    { state: "DONE", late: false },
  ] as const;

  it("each show one kind of work", () => {
    const shown = (filter: (typeof TASK_FILTERS)[number]) => items.filter((item) => matchesFilter(item, filter)).length;
    assert.equal(shown("all"), 9);
    assert.equal(shown("open"), 7);
    assert.equal(shown("progress"), 2);
    assert.equal(shown("review"), 2);
    assert.equal(shown("late"), 3);
    assert.equal(shown("done"), 2);
  });

  // The number on a button and the list under it are worked out separately on
  // every screen; they are only ever the same number because of this.
  it("are counted by the same rule they are shown by", () => {
    const counts = countByFilter(items);
    for (const filter of TASK_FILTERS) {
      assert.equal(counts[filter], items.filter((item) => matchesFilter(item, filter)).length, filter);
    }
    assert.deepEqual(countByFilter([]), { open: 0, progress: 0, review: 0, late: 0, done: 0, all: 0 });
  });

  it("are read from a URL without ever showing an empty page for a bad one", () => {
    assert.equal(readTaskFilter("late"), "late");
    assert.equal(readTaskFilter("review"), "review");
    assert.equal(readTaskFilter(undefined), "open");
    assert.equal(readTaskFilter("nonsense"), "open");
    assert.equal(readTaskFilter(["late"]), "open");
    assert.equal(readTaskFilter(undefined, "all"), "all");
    // What "done" was called until now, on a page somebody left open.
    assert.equal(readTaskFilter("completed"), "done");
  });
});

// Every one of these typechecks, builds and looks right with the rule quietly
// written a second time — which is how a button comes to say 3 over a list of 2.
describe("one reading of a task's standing, on every screen", () => {
  it("is what the team's list, the manager's week and the Assign view all use", () => {
    for (const file of [
      ["src", "app", "employee", "(portal)", "tasks", "page.tsx"],
      ["src", "components", "admin", "week-board.tsx"],
      ["src", "components", "tasks", "assign-work.tsx"],
    ]) {
      const source = read(...file);
      assert.match(source, /from "@\/lib\/task-filters"/, file.join("/"));
      assert.match(source, /countByFilter\(/, file.join("/"));
      assert.match(source, /matchesFilter\(/, file.join("/"));
      assert.match(source, /isLate\(/, file.join("/"));
    }
  });

  // The card counts down to the stage's deadline. Late by anything else — the
  // day it was merely planned for — and the filter lists cards that do not say late.
  it("calls a board task late by the deadline its card counts down to", () => {
    const page = read("src", "app", "employee", "(portal)", "tasks", "page.tsx");
    assert.match(page, /const deadline = plan\.get\(task\.id\)\?\.dueBy \?\? null;/);
    assert.match(page, /late: isLate\(task\.state, deadline \? dayKeyIn\(timezone, deadline\) : null, today\)/);
  });
});

describe("a task wears its priority", () => {
  it("as the whole card, from one place", () => {
    const priority = read("src", "components", "tasks", "priority.ts");
    assert.match(priority, /HIGH: "task-high"/);
    for (const card of ["task-card.tsx", "assigned-task-card.tsx"]) {
      const source = read("src", "components", "employee", card);
      assert.match(source, /!done && PRIORITY_CARD\[task\.priority\]/, card);
      assert.equal(/const PRIORITY_STYLE/.test(source), false, `${card} has its own colours again`);
    }
    assert.match(read("src", "components", "admin", "week-board.tsx"), /from "@\/components\/tasks\/priority"/);
  });

  // .glass paints its background outside any layer, so a bg-* utility on the
  // card does nothing at all: the class has to exist in the stylesheet, and
  // beat the portal's own .glass.
  it("with a class the stylesheet actually defines", () => {
    const css = read("src", "app", "globals.css");
    assert.match(css, /\.employee-shell \.glass\.task-high \{/);
    assert.match(css, /\.employee-shell \.glass\.task-low \{/);
    assert.ok(
      css.indexOf(".employee-shell .glass.task-high") > css.indexOf(".employee-shell .glass,"),
      "the priority wash has to come after the portal's own .glass"
    );
  });
});
