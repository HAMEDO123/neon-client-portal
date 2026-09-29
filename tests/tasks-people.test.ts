import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { asPercent, progressOf } from "../src/lib/analytics";
import { percentDone } from "../src/lib/progress";
import {
  cellOverdue,
  completionPercent,
  jobOverdue,
  periodWindow,
  sortItems,
  tallyWork,
  type CountedItem,
} from "../src/lib/mobile/tasks-people-rules";

// The Team segment of the manager's Tasks tab: what share of the work each
// person was given is done. Pure rules only; the query is tasks-people.ts.

describe("the percentage of given work that is done", () => {
  it("is null — not 0% — when nothing was given", () => {
    assert.equal(completionPercent({ done: 0, total: 0 }), null);
  });

  it("is 0% only when work was given and none of it is done", () => {
    assert.equal(completionPercent({ done: 0, total: 5 }), 0);
  });

  it("is 100% when everything given is done", () => {
    assert.equal(completionPercent({ done: 4, total: 4 }), 100);
  });

  it("rounds to a whole percent", () => {
    assert.equal(completionPercent({ done: 1, total: 5 }), 20);
    assert.equal(completionPercent({ done: 1, total: 3 }), 33);
    assert.equal(completionPercent({ done: 2, total: 3 }), 67);
    assert.equal(completionPercent({ done: 1, total: 8 }), 13, "12.5 rounds up");
    assert.equal(completionPercent({ done: 1, total: 6 }), 17);
  });

  it("is the same number the analytics page prints", () => {
    for (const [done, total] of [[1, 3], [2, 3], [5, 7], [9, 10], [1, 8], [7, 9]]) {
      const counts = { done, total };
      assert.equal(completionPercent(counts), percentDone(counts));
      assert.equal(completionPercent(counts), asPercent(progressOf({ completed: done, total })));
    }
  });
});

describe("one person's period", () => {
  const item = (state: string, kind: CountedItem["kind"] = "cell", overdue = false): CountedItem => ({ kind, state, overdue });

  it("counts only approved work as done — sent for review is not done", () => {
    const tally = tallyWork([item("DONE"), item("SUBMITTED"), item("IN_PROGRESS"), item("TODO"), item("TOMORROW", "job")]);
    assert.equal(tally.total, 5);
    assert.equal(tally.done, 1);
    assert.equal(tally.submitted, 1);
    assert.equal(tally.inProgress, 1);
    assert.equal(tally.todo, 2, "TOMORROW is still work waiting");
    assert.equal(tally.percent, 20);
  });

  it("splits board steps from jobs handed out by hand", () => {
    const tally = tallyWork([item("DONE"), item("TODO"), item("DONE", "job"), item("DONE", "job"), item("SUBMITTED", "job")]);
    assert.deepEqual(tally.boardCells, { total: 2, done: 1 });
    assert.deepEqual(tally.jobs, { total: 3, done: 2 });
    assert.equal(tally.percent, 60);
  });

  it("has no percentage for somebody given nothing", () => {
    const tally = tallyWork([]);
    assert.equal(tally.total, 0);
    assert.equal(tally.percent, null);
    assert.equal(tally.overdue, 0);
  });

  it("counts the late ones", () => {
    assert.equal(tallyWork([item("TODO", "cell", true), item("IN_PROGRESS", "job", true), item("DONE")]).overdue, 2);
  });
});

describe("what is late", () => {
  const now = new Date("2026-09-29T12:00:00.000Z");

  it("is a cell past its deadline that nobody has handed in", () => {
    const past = new Date("2026-09-29T09:00:00.000Z");
    assert.equal(cellOverdue("TODO", past, now), true);
    assert.equal(cellOverdue("IN_PROGRESS", past, now), true);
    assert.equal(cellOverdue("SUBMITTED", past, now), false, "handed in: waiting on the manager, not late on them");
    assert.equal(cellOverdue("DONE", past, now), false);
    assert.equal(cellOverdue("TODO", new Date("2026-09-29T15:00:00.000Z"), now), false);
    assert.equal(cellOverdue("TODO", null, now), false, "no deadline, nothing to be late for");
  });

  it("is a job from the day after its last day", () => {
    assert.equal(jobOverdue("TODO", "2026-09-29", "2026-09-29"), false, "due today is not late yet");
    assert.equal(jobOverdue("TODO", "2026-09-28", "2026-09-29"), true);
    assert.equal(jobOverdue("SUBMITTED", "2026-09-28", "2026-09-29"), false);
    assert.equal(jobOverdue("DONE", "2026-09-28", "2026-09-29"), false);
  });
});

describe("the period being counted", () => {
  it("is the board's week, Sunday to Saturday", () => {
    // 2026-09-29 is a Tuesday.
    assert.deepEqual(periodWindow("week", "2026-09-29"), {
      from: "2026-09-27",
      to: "2026-10-03",
      previous: "2026-09-20",
      next: "2026-10-04",
    });
  });

  it("is the payroll month", () => {
    assert.deepEqual(periodWindow("month", "2026-09-29"), {
      from: "2026-09-01",
      to: "2026-09-30",
      previous: "2026-08-01",
      next: "2026-10-01",
    });
    assert.equal(periodWindow("month", "2026-02-10").to, "2026-02-28");
    assert.equal(periodWindow("month", "2026-01-05").previous, "2025-12-01");
  });
});

describe("the order the list is read in", () => {
  const row = (id: string, state: string, overdue: boolean, dueDay: string | null) => ({
    id,
    kind: "cell" as const,
    state,
    overdue,
    dueDay,
    scheduledFor: null,
    startDay: null,
  });

  it("puts late work first, then open, then sent for review, then done — soonest first", () => {
    const sorted = sortItems([
      row("done", "DONE", false, "2026-09-27"),
      row("review", "SUBMITTED", false, "2026-09-28"),
      row("open-later", "TODO", false, "2026-10-02"),
      row("undated", "TODO", false, null),
      row("open-sooner", "IN_PROGRESS", false, "2026-09-30"),
      row("late", "TODO", true, "2026-09-28"),
    ]);
    assert.deepEqual(
      sorted.map((item) => item.id),
      ["late", "open-sooner", "open-later", "undated", "review", "done"]
    );
  });
});
