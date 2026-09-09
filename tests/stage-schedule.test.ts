import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  addDays,
  countdownOf,
  daysUntil,
  periodTimeline,
  planStages,
  totalDays,
  type PeriodInput,
  type StageInput,
} from "../src/lib/stage-schedule";
import { stageReminderCopy } from "../src/lib/notifications/types";

const START = new Date("2026-09-01T09:00:00.000Z");

function stage(overrides: Partial<StageInput> & { taskId: string; order: number }): StageInput {
  return {
    entryId: overrides.taskId,
    state: "TODO",
    startedAt: null,
    completedAt: null,
    scheduledFor: null,
    dueAt: null,
    ...overrides,
  };
}

/** Site visit → BOQ, then plan → render, the way the process is actually cut. */
const SITE = ["visit", "measure", "payment", "boq"];
const DESIGN = ["plan", "model", "render"];

function process(): StageInput[] {
  return [...SITE, ...DESIGN].map((taskId, order) => stage({ taskId, order }));
}

function period(fromTaskId: string, toTaskId: string, days: number): PeriodInput {
  return { fromTaskId, toTaskId, days };
}

describe("periods are ranges, not a number per step", () => {
  it("gives every step in a range the range's deadline", () => {
    const plans = planStages(process(), [period("visit", "boq", 4)], START);

    const due = addDays(START, 4);
    // All four steps of the range share one deadline — the range is the unit.
    for (const index of [0, 1, 2, 3]) {
      assert.deepEqual(plans[index].dueBy, due);
      assert.equal(plans[index].source, "derived");
    }
  });

  it("starts the next range when the one before it ends", () => {
    const plans = planStages(process(), [period("visit", "boq", 4), period("plan", "render", 3)], START);

    assert.deepEqual(plans[0].dueBy, addDays(START, 4));
    assert.deepEqual(plans[4].startsAt, addDays(START, 4));
    assert.deepEqual(plans[4].dueBy, addDays(START, 7));

    // Which is what "four days then three" means end to end.
    assert.equal(totalDays([period("visit", "boq", 4), period("plan", "render", 3)]), 7);
  });

  it("reads a range named backwards as the same range", () => {
    const forwards = planStages(process(), [period("visit", "boq", 4)], START);
    const backwards = planStages(process(), [period("boq", "visit", 4)], START);
    assert.deepEqual(backwards[2].dueBy, forwards[2].dueBy);
  });

  it("leaves steps outside every range untimed, without stalling the chain", () => {
    const plans = planStages(process(), [period("plan", "render", 3)], START);

    // Nothing covers the site steps, so nobody is chased about them.
    for (const index of [0, 1, 2, 3]) {
      assert.equal(plans[index].dueBy, null);
      assert.equal(plans[index].source, "none");
    }
    // And the range behind them still gets its days.
    assert.deepEqual(plans[4].dueBy, addDays(START, 3));
  });

  it("respects a deadline the manager typed over the range's own", () => {
    const explicit = new Date("2026-09-20T12:00:00.000Z");
    const stages = process();
    stages[2] = stage({ taskId: "payment", order: 2, dueAt: explicit });

    const plans = planStages(stages, [period("visit", "boq", 4)], START);

    assert.equal(plans[2].source, "explicit");
    assert.deepEqual(plans[2].dueBy, explicit);
    // Its neighbours in the range keep the computed one.
    assert.deepEqual(plans[1].dueBy, addDays(START, 4));
  });

  it("moves everything behind a range that actually finished late", () => {
    const lateFinish = new Date("2026-09-12T17:00:00.000Z");
    const stages = process();
    for (const [index, taskId] of SITE.entries()) {
      stages[index] = stage({
        taskId,
        order: index,
        state: "DONE",
        completedAt: index === SITE.length - 1 ? lateFinish : new Date("2026-09-03T09:00:00.000Z"),
      });
    }

    const plans = planStages(stages, [period("visit", "boq", 4), period("plan", "render", 3)], START);

    // Not day 4 — the real completion is what the next range starts from.
    assert.deepEqual(plans[4].startsAt, lateFinish);
    assert.deepEqual(plans[4].dueBy, addDays(lateFinish, 3));
  });

  it("starts a range from the day its work was actually picked up", () => {
    const started = new Date("2026-09-05T08:00:00.000Z");
    const stages = process();
    stages[1] = stage({ taskId: "measure", order: 1, state: "IN_PROGRESS", startedAt: started });

    const plans = planStages(stages, [period("visit", "boq", 4)], START);
    assert.deepEqual(plans[0].startsAt, started);
    assert.deepEqual(plans[0].dueBy, addDays(started, 4));
  });

  it("ignores a range naming a step that no longer exists", () => {
    const plans = planStages(process(), [period("visit", "deleted-step", 4)], START);
    assert.equal(plans[0].dueBy, null);
  });
});

describe("the countdown an employee sees", () => {
  const now = new Date("2026-09-09T10:00:00.000Z");

  it("counts days the way a person does", () => {
    assert.equal(daysUntil(new Date("2026-09-09T18:00:00.000Z"), now), 1);
    assert.equal(countdownOf(new Date("2026-09-09T09:00:00.000Z"), now).label, "Due today");
    assert.equal(countdownOf(new Date("2026-09-11T09:00:00.000Z"), now).label, "2 days left");
  });

  it("says how late, once it is late", () => {
    const late = countdownOf(new Date("2026-09-06T09:00:00.000Z"), now);
    assert.equal(late.overdue, true);
    assert.equal(late.label, "3 days late");
    assert.equal(late.tone, "late");
  });

  it("warns before it panics", () => {
    assert.equal(countdownOf(new Date("2026-09-20T09:00:00.000Z"), now).tone, "calm");
    assert.equal(countdownOf(new Date("2026-09-11T09:00:00.000Z"), now).tone, "soon");
  });

  it("is singular where it should be", () => {
    assert.equal(countdownOf(new Date("2026-09-10T09:00:00.000Z"), now).label, "1 day left");
    assert.equal(countdownOf(new Date("2026-09-08T09:00:00.000Z"), now).label, "1 day late");
  });
});

describe("what the reminder says", () => {
  const now = new Date("2026-09-09T10:00:00.000Z");

  it("leads with the time left, not the date", () => {
    const soon = stageReminderCopy("2D Plan", "Bond Cafe", countdownOf(new Date("2026-09-11T09:00:00.000Z"), now));
    assert.equal(soon.title, "Deadline approaching");
    assert.match(soon.message, /2 days left/);

    const late = stageReminderCopy("2D Plan", "Bond Cafe", countdownOf(new Date("2026-09-07T09:00:00.000Z"), now));
    assert.equal(late.title, "Task overdue");
    assert.match(late.message, /2 days late/);
    assert.match(late.message, /send a photo/);
  });
});

describe("the timeline on the settings screen", () => {
  const order = [...SITE, ...DESIGN];

  it("says which days of the process each range occupies", () => {
    const timeline = periodTimeline(order, [period("visit", "boq", 4), period("plan", "render", 3)]);

    assert.deepEqual(
      timeline.map((row) => ({ startDay: row.startDay, endDay: row.endDay, steps: row.steps })),
      [
        { startDay: 1, endDay: 4, steps: 4 },
        { startDay: 5, endDay: 7, steps: 3 },
      ]
    );
  });

  it("reads the ranges in process order, however they were added", () => {
    const timeline = periodTimeline(order, [period("plan", "render", 3), period("visit", "boq", 4)]);
    assert.equal(timeline[0].period.fromTaskId, "visit");
    assert.equal(timeline[1].period.fromTaskId, "plan");
  });

  it("drops a range naming a step that no longer exists", () => {
    assert.equal(periodTimeline(order, [period("visit", "gone", 4)]).length, 0);
  });
});
