import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildDayBrief, parsePlan, planBlocksFrom, refOf, refsFor, type PlanTask } from "../src/lib/day-plan";

const PERSON = { name: "Wael", role: "Draughtsman", playbook: "Two drawings a day. Never sends to a client himself." };

function task(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id: "t1",
    name: "2D plan",
    projectName: "Villa Al-Fulan",
    location: null,
    readiness: { status: "ready" },
    priority: "MEDIUM",
    scheduledForDay: false,
    dueLabel: null,
    estimateHours: null,
    deliverable: null,
    acceptance: null,
    lastUpdateNote: null,
    ...overrides,
  };
}

function brief(tasks: PlanTask[], notes = "Site visits in the morning.") {
  return buildDayBrief({ person: PERSON, notes, dayLabel: "Sunday", tasks });
}

describe("the brief a proposal is built from", () => {
  it("carries what the person usually does and how the studio plans", () => {
    const text = brief([task()]);

    assert.ok(text.includes("Wael"));
    assert.ok(text.includes("Draughtsman"));
    assert.ok(text.includes("Two drawings a day"));
    assert.ok(text.includes("Site visits in the morning."));
  });

  it("says a section is empty rather than leaving it out", () => {
    const text = buildDayBrief({
      person: { name: "Wael", role: null, playbook: "   " },
      notes: "",
      dayLabel: "Sunday",
      tasks: [],
    });

    // Twice: nothing written about the person, and nothing about the studio.
    assert.equal(text.split("(nothing written down yet)").length - 1, 2);
    assert.ok(text.includes("nothing open on the board"));
  });

  it("gives every task a code, in the order it was handed over", () => {
    const text = brief([task({ name: "2D plan" }), task({ id: "t2", name: "Renders" })]);

    assert.ok(text.includes('[T1] · [ready] · "2D plan"'));
    assert.ok(text.includes('[T2] · [ready] · "Renders"'));
    assert.equal(refOf(0), "T1");
    assert.equal(refOf(2), "T3");
  });

  it("resolves those codes back to the very tasks they were made from", () => {
    const tasks = [task({ id: "a" }), task({ id: "b" }), task({ id: "c" })];
    const byRef = refsFor(tasks);

    assert.equal(byRef.get("T1")?.id, "a");
    assert.equal(byRef.get("T3")?.id, "c");
    assert.equal(byRef.get("T4"), undefined);
  });

  it("ties a block to the board cell its code stands for, and ticks the whole day", () => {
    const tasks = [task({ id: "entry-a", name: "2D plan" }), task({ id: "entry-b", name: "Renders" })];
    const { blocks } = parsePlan(
      ["09:00-11:00 | T2 | Renders for the villa | Due today", "11:00-11:15 | - | Break | Rest"].join("\n")
    );

    const planned = planBlocksFrom(blocks, tasks);

    assert.equal(planned[0].entryId, "entry-b");
    assert.equal(planned[0].taskName, "Renders");
    // The rest of a working day is real work too — it becomes a job.
    assert.equal(planned[1].entryId, null);
    assert.deepEqual(
      planned.map((block) => block.keep),
      [true, true]
    );
    // Nothing has been handed out yet, so nothing carries a job.
    assert.deepEqual(
      planned.map((block) => block.jobId),
      [null, null]
    );
  });

  it("lists every task with what finishing it means", () => {
    const text = brief([
      task({ name: "2D plan", deliverable: "PDF with dimensions", acceptance: "Every room labelled" }),
      task({ id: "t2", name: "Bill of quantities" }),
    ]);

    assert.ok(text.includes('"2D plan"'));
    assert.ok(text.includes('"Bill of quantities"'));
    assert.ok(text.includes("hand in: PDF with dimensions"));
    assert.ok(text.includes("done when: Every room labelled"));
  });

  it("says what cannot be started, and who can clear it", () => {
    const text = brief([
      task({ readiness: { status: "blocked", reason: "Site measurements missing", ownerName: "Ali" } }),
      task({ id: "t2", name: "Renders", readiness: { status: "waiting", on: ["2D plan"] } }),
    ]);

    assert.ok(text.includes("[blocked]"));
    assert.ok(text.includes("Site measurements missing"));
    assert.ok(text.includes("(Ali can clear it)"));
    assert.ok(text.includes("[waiting]"));
    assert.ok(text.includes("Starts when 2D plan is finished."));
  });

  it("marks the day's own work, the urgent work and the expected hours", () => {
    const text = brief([task({ scheduledForDay: true, priority: "HIGH", estimateHours: 3, dueLabel: "today 17:00" })]);

    assert.ok(text.includes("already put on this day"));
    assert.ok(text.includes("urgent"));
    assert.ok(text.includes("expected 3 h"));
    assert.ok(text.includes("due today 17:00"));
  });

  it("keeps half-hour estimates readable", () => {
    assert.ok(brief([task({ estimateHours: 0.5 })]).includes("expected 30 min"));
    assert.ok(brief([task({ estimateHours: 2.5 })]).includes("expected 2.5 h"));
  });
});

describe("reading the timetable back", () => {
  it("reads a block's times, its task and why", () => {
    const { blocks } = parsePlan("09:00-10:30 | T2 | Draw the 2D plan | It is due at 17:00");

    assert.deepEqual(blocks, [
      { from: "09:00", to: "10:30", ref: "T2", what: "Draw the 2D plan", why: "It is due at 17:00" },
    ]);
  });

  it("treats a dash where the code goes as a block that touches no task", () => {
    const { blocks } = parsePlan("13:00-13:45 | - | Break | Lunch");

    assert.equal(blocks[0].ref, null);
    assert.equal(blocks[0].what, "Break");
  });

  it("still reads a block that came back without a code at all", () => {
    const { blocks } = parsePlan("09:00-10:00 | Site visit | Mornings are for site visits");

    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].ref, null);
    assert.equal(blocks[0].what, "Site visit");
    assert.equal(blocks[0].why, "Mornings are for site visits");
  });

  it("accepts a bullet, a dash of any kind, and a single-digit hour", () => {
    const { blocks } = parsePlan("- 9:00 – 9:30 | T1 | Site visit | Mornings are for site visits");

    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].from, "09:00");
    assert.equal(blocks[0].to, "09:30");
    assert.equal(blocks[0].ref, "T1");
  });

  it("leaves why empty when the model gave none", () => {
    const { blocks } = parsePlan("13:00-14:00 | T1 | Break |");

    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].why, null);
  });

  it("keeps anything that is not a block instead of dropping it", () => {
    const { blocks, rest } = parsePlan(
      ["Here is the day:", "09:00-10:00 | T1 | Drawings | Due today", "", "The renders will not fit today."].join("\n")
    );

    assert.equal(blocks.length, 1);
    assert.deepEqual(rest, ["Here is the day:", "The renders will not fit today."]);
  });

  it("refuses a time that is not a time", () => {
    const { blocks, rest } = parsePlan("99:99-10:00 | T1 | Nonsense | No");

    assert.equal(blocks.length, 0);
    assert.equal(rest.length, 1);
  });

  it("reads an Arabic plan the same way", () => {
    const { blocks } = parsePlan("08:30-10:00 | T2 | زيارة موقع فيلا الفلان | الزيارات بالصبح");

    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].ref, "T2");
    assert.equal(blocks[0].what, "زيارة موقع فيلا الفلان");
    assert.equal(blocks[0].why, "الزيارات بالصبح");
  });
});
