import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MID_CHECK_AFTER_MINUTES, firstAskableDay, followUpKey, followUpsFor, mayAskNow } from "../src/lib/follow-ups";
import { DEFAULT_WORK_HOURS } from "../src/lib/work-hours";

// The working day here is 11:00 to 19:00 with lunch 14:00–14:30.
const hours = DEFAULT_WORK_HOURS;
const DAY = "1970-01-04"; // a Sunday, which is a working day

function plan(...blocks: [string, string][]) {
  return blocks.map(([from, to]) => ({ from, to, keep: true }));
}

describe("what is asked about a planned day", () => {
  it("always opens and closes the day", () => {
    const found = followUpsFor({ dayKey: DAY, hours, blocks: [] });

    assert.deepEqual(
      found.map((f) => [f.kind, f.at]),
      [
        ["day-start", "11:00"],
        ["day-end", "19:00"],
      ]
    );
  });

  it("asks at the start and the end of every block on the day", () => {
    const found = followUpsFor({ dayKey: DAY, hours, blocks: plan(["11:00", "12:00"]) });

    assert.deepEqual(
      found.map((f) => `${f.kind}@${f.at}`),
      ["day-start@11:00", "block-start@11:00", "block-end@12:00", "day-end@19:00"]
    );
  });

  it("checks in part-way through a long block, and not through a short one", () => {
    const long = followUpsFor({ dayKey: DAY, hours, blocks: plan(["11:00", "13:00"]) });
    assert.ok(long.some((f) => f.kind === "block-middle" && f.at === "12:00"));

    const short = followUpsFor({ dayKey: DAY, hours, blocks: plan(["11:00", "12:00"]) });
    assert.ok(!short.some((f) => f.kind === "block-middle"));
    assert.equal(MID_CHECK_AFTER_MINUTES, 90);
  });

  it("says nothing about a block that was never put on the day", () => {
    const found = followUpsFor({
      dayKey: DAY,
      hours,
      blocks: [{ from: "11:00", to: "12:00", keep: false }],
    });

    assert.deepEqual(
      found.map((f) => f.kind),
      ["day-start", "day-end"]
    );
  });

  it("ignores a block whose times make no sense", () => {
    const found = followUpsFor({
      dayKey: DAY,
      hours,
      blocks: [
        { from: "13:00", to: "11:00", keep: true },
        { from: "not a time", to: "12:00", keep: true },
      ],
    });

    assert.deepEqual(
      found.map((f) => f.kind),
      ["day-start", "day-end"]
    );
  });

  it("is in the order the questions come due", () => {
    const found = followUpsFor({
      dayKey: DAY,
      hours,
      blocks: plan(["15:00", "16:00"], ["11:30", "12:30"]),
    });

    const times = found.map((f) => f.at);
    assert.deepEqual([...times].sort(), times);
  });
});

describe("nobody is chased at the wrong moment", () => {
  it("moves a question in the lunch hour to the moment lunch ends", () => {
    const found = followUpsFor({ dayKey: DAY, hours, blocks: plan(["14:10", "15:00"]) });

    assert.ok(found.some((f) => f.kind === "block-start" && f.at === "14:30"));
  });

  it("keeps an end-of-day question on the day it is about", () => {
    // A block running to the bell: asking tomorrow morning is asking too late.
    const found = followUpsFor({ dayKey: DAY, hours, blocks: plan(["18:00", "19:00"]) });

    const end = found.find((f) => f.kind === "block-end");
    assert.equal(end?.at, "19:00");
    assert.equal(end?.dayKey, DAY);
  });

  it("never produces a time outside the working day", () => {
    const found = followUpsFor({
      dayKey: DAY,
      hours,
      blocks: plan(["08:00", "09:00"], ["11:00", "12:00"], ["20:00", "21:00"]),
    });

    for (const followUp of found) {
      assert.ok(followUp.at >= hours.start, `${followUp.kind} at ${followUp.at} is before the day`);
      assert.ok(followUp.at <= hours.end, `${followUp.kind} at ${followUp.at} is after the day`);
    }
  });

  it("knows when somebody may be messaged at all", () => {
    assert.equal(mayAskNow(hours, DAY, "11:30"), true);
    assert.equal(mayAskNow(hours, DAY, "14:10"), false);
    assert.equal(mayAskNow(hours, DAY, "20:00"), false);
    // A Friday: nobody is in, whatever the clock says.
    assert.equal(mayAskNow(hours, "1970-01-02", "12:00"), false);
  });
});

describe("asking once", () => {
  it("keys a question to the event, never to the clock", () => {
    const key = followUpKey("emp1", DAY, "block-start", 2, "11:30");

    assert.equal(key, "FOLLOW_UP:block-start:emp1:1970-01-04:2:11:30");
    assert.equal(key, followUpKey("emp1", DAY, "block-start", 2, "11:30"));
  });

  it("earns a new key when the block moves, and a different one per person", () => {
    const first = followUpKey("emp1", DAY, "block-start", 2, "11:30");

    assert.notEqual(first, followUpKey("emp1", DAY, "block-start", 2, "12:00"));
    assert.notEqual(first, followUpKey("emp2", DAY, "block-start", 2, "11:30"));
    assert.notEqual(first, followUpKey("emp1", DAY, "block-end", 2, "11:30"));
  });
});

describe("a question belongs to its own day", () => {
  // Amman is UTC+3 all year.
  it("asks about today, in the company's timezone", () => {
    // 20:00 in Amman on the 15th.
    assert.equal(firstAskableDay("Asia/Amman", new Date("2026-09-15T17:00:00Z")), "2026-09-15");
  });

  it("moves on at the company's midnight, not at UTC's", () => {
    // 23:59 in Amman: the 15th is still today.
    assert.equal(firstAskableDay("Asia/Amman", new Date("2026-09-15T20:59:00Z")), "2026-09-15");
    // 01:30 on the 16th in Amman, while UTC still reads the 15th: a question
    // about the 15th is now about a day that is over.
    assert.equal(firstAskableDay("Asia/Amman", new Date("2026-09-15T22:30:00Z")), "2026-09-16");
  });
});
