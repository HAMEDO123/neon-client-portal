import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { countStates, dayOfWindow, percentDone, windowFraction, windowLabel } from "../src/lib/progress";

describe("how far through its time a task is", () => {
  it("counts the days of the window", () => {
    const window = dayOfWindow("2026-09-08", "2026-09-12", "2026-09-10");
    assert.deepEqual(window, { day: 3, total: 5, over: 0, startsIn: 0 });
    assert.equal(windowLabel(window), "Day 3 of 5");
    assert.equal(windowFraction(window), 0.6);
  });

  it("is full on the last day, and says how late after it", () => {
    assert.equal(windowFraction(dayOfWindow("2026-09-08", "2026-09-12", "2026-09-12")), 1);

    const late = dayOfWindow("2026-09-08", "2026-09-12", "2026-09-14");
    assert.equal(late.over, 2);
    assert.equal(windowFraction(late), 1);
    assert.equal(windowLabel(late), "2 days over");
  });

  it("is empty before it starts, and says when it will", () => {
    const soon = dayOfWindow("2026-09-11", "2026-09-12", "2026-09-10");
    assert.equal(windowFraction(soon), 0);
    assert.equal(windowLabel(soon), "Starts tomorrow");
    assert.equal(windowLabel(dayOfWindow("2026-09-15", "2026-09-16", "2026-09-10")), "Starts in 5 days");
  });

  it("treats a one-day job as one day", () => {
    const today = dayOfWindow("2026-09-10", "2026-09-10", "2026-09-10");
    assert.equal(windowLabel(today), "Day 1 of 1");
    assert.equal(windowFraction(today), 1);
  });

  it("reads a window written backwards as the same window", () => {
    assert.deepEqual(dayOfWindow("2026-09-12", "2026-09-08", "2026-09-10"), dayOfWindow("2026-09-08", "2026-09-12", "2026-09-10"));
  });
});

describe("how the day's work adds up", () => {
  it("sorts tasks by where they stand", () => {
    const counts = countStates(["DONE", "DONE", "SUBMITTED", "IN_PROGRESS", "TODO", "TOMORROW"]);
    assert.deepEqual(counts, { done: 2, review: 1, working: 1, pending: 2, total: 6 });
    assert.equal(percentDone(counts), 33);
  });

  it("says nothing is done when there is nothing to do", () => {
    assert.equal(percentDone(countStates([])), 0);
  });
});
