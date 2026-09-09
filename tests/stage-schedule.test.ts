import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  addDays,
  countdownOf,
  cumulativeDays,
  daysUntil,
  planStages,
  totalDays,
  type StageInput,
} from "../src/lib/stage-schedule";
import { stageReminderCopy } from "../src/lib/notifications/types";

const START = new Date("2026-09-01T09:00:00.000Z");

function stage(overrides: Partial<StageInput> & { entryId: string; order: number }): StageInput {
  return {
    durationDays: null,
    state: "TODO",
    startedAt: null,
    completedAt: null,
    scheduledFor: null,
    dueAt: null,
    ...overrides,
  };
}

describe("planning a project's stages", () => {
  it("chains one stage into the next", () => {
    const plans = planStages(
      [
        stage({ entryId: "plan", order: 0, durationDays: 2 }),
        stage({ entryId: "model", order: 1, durationDays: 3 }),
        stage({ entryId: "visit", order: 2, durationDays: 1 }),
      ],
      START
    );

    // Two days for the plan, then three for the model starting where it ended.
    assert.deepEqual(plans[0].dueBy, addDays(START, 2));
    assert.deepEqual(plans[1].startsAt, addDays(START, 2));
    assert.deepEqual(plans[1].dueBy, addDays(START, 5));
    assert.deepEqual(plans[2].dueBy, addDays(START, 6));

    // Which is what "from the plan to the site visit is six days" means.
    assert.equal(totalDays([2, 3, 1]), 6);
  });

  it("respects a deadline the manager typed over a computed one", () => {
    const explicit = new Date("2026-09-10T12:00:00.000Z");
    const plans = planStages(
      [
        stage({ entryId: "plan", order: 0, durationDays: 2, dueAt: explicit }),
        stage({ entryId: "model", order: 1, durationDays: 3 }),
      ],
      START
    );

    assert.equal(plans[0].source, "explicit");
    assert.deepEqual(plans[0].dueBy, explicit);
    // And the stage behind it waits for that date, not the shorter one.
    assert.deepEqual(plans[1].startsAt, explicit);
  });

  it("moves everything behind a stage that actually ran late", () => {
    const finishedLate = new Date("2026-09-06T17:00:00.000Z");
    const plans = planStages(
      [
        stage({ entryId: "plan", order: 0, durationDays: 2, state: "DONE", completedAt: finishedLate }),
        stage({ entryId: "model", order: 1, durationDays: 3 }),
      ],
      START
    );

    // Not day 2 — the real completion date is what the next stage starts from.
    assert.deepEqual(plans[1].startsAt, finishedLate);
    assert.deepEqual(plans[1].dueBy, addDays(finishedLate, 3));
  });

  it("starts a stage from the day it was actually picked up", () => {
    const started = new Date("2026-09-04T08:00:00.000Z");
    const plans = planStages(
      [stage({ entryId: "plan", order: 0, durationDays: 2, state: "IN_PROGRESS", startedAt: started })],
      START
    );

    assert.deepEqual(plans[0].dueBy, addDays(started, 2));
  });

  it("leaves an untimed stage without a deadline, and does not stall the chain", () => {
    const plans = planStages(
      [
        stage({ entryId: "untimed", order: 0 }),
        stage({ entryId: "model", order: 1, durationDays: 3 }),
      ],
      START
    );

    assert.equal(plans[0].dueBy, null);
    assert.equal(plans[0].source, "none");
    // The next stage still gets its days, counted from the anchor.
    assert.deepEqual(plans[1].dueBy, addDays(START, 3));
  });

  it("reads the stages in process order, not the order they arrive in", () => {
    const plans = planStages(
      [
        stage({ entryId: "second", order: 1, durationDays: 5 }),
        stage({ entryId: "first", order: 0, durationDays: 1 }),
      ],
      START
    );

    assert.equal(plans[0].entryId, "first");
    assert.deepEqual(plans[1].dueBy, addDays(START, 6));
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

    const today = stageReminderCopy("2D Plan", "Bond Cafe", countdownOf(new Date("2026-09-09T18:00:00.000Z"), now));
    assert.match(today.message, /1 day left/);

    const late = stageReminderCopy("2D Plan", "Bond Cafe", countdownOf(new Date("2026-09-07T09:00:00.000Z"), now));
    assert.equal(late.title, "Task overdue");
    assert.match(late.message, /2 days late/);
    assert.match(late.message, /send a photo/);
  });
});

describe("the running total on the settings screen", () => {
  it("says which days of the process each stage occupies", () => {
    assert.deepEqual(cumulativeDays([2, 3, 1]), [
      { startDay: 1, endDay: 2 },
      { startDay: 3, endDay: 5 },
      { startDay: 6, endDay: 6 },
    ]);
  });

  it("skips an untimed stage without shifting the ones after it", () => {
    assert.deepEqual(cumulativeDays([2, null, 1]), [
      { startDay: 1, endDay: 2 },
      { startDay: 3, endDay: null },
      { startDay: 3, endDay: 3 },
    ]);
    assert.equal(totalDays([2, null, 1]), 3);
  });
});
