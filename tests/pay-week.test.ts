import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PAY_WEEK_START_DAY,
  inPayWeek,
  paySlices,
  payWeekOf,
  payWeekSpan,
  payWeekStartKey,
  payWeeksInMonth,
} from "../src/lib/pay-week";

// October 2026: the 1st is a Thursday. Its Tuesdays are the 6th, 13th, 20th
// and 27th, and the week that covers 1–5 October began on Tuesday 29 September.
const MONTH = "2026-10";

describe("the pay week", () => {
  it("starts on Tuesday", () => {
    assert.equal(PAY_WEEK_START_DAY, 2);
    assert.equal(payWeekStartKey("2026-10-06"), "2026-10-06", "a Tuesday is its own start");
    assert.equal(payWeekStartKey("2026-10-07"), "2026-10-06");
    assert.equal(payWeekStartKey("2026-10-12"), "2026-10-06", "Monday is the last day of it");
    assert.equal(payWeekStartKey("2026-10-13"), "2026-10-13", "and the next Tuesday starts the next");
  });

  it("runs Tuesday to Monday", () => {
    const week = payWeekOf("2026-10-08");
    assert.equal(week.startKey, "2026-10-06");
    assert.equal(week.endKey, "2026-10-12");
    assert.equal(week.label, "Tue 6 – Mon 12 Oct");
  });

  it("names the months when it crosses one", () => {
    assert.equal(payWeekOf("2026-10-28").label, "Tue 27 Oct – Mon 2 Nov");
  });

  it("gives a month its weeks, by the Tuesday each begins on", () => {
    const weeks = payWeeksInMonth(MONTH);
    assert.deepEqual(
      weeks.map((week) => week.startKey),
      ["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27"]
    );
    // The last one runs past the end of the month, uncut: a week is what
    // somebody is paid for, and half a week's deductions against a whole
    // week's salary is the same mistake in miniature.
    assert.equal(weeks[3].endKey, "2026-11-02");
    assert.deepEqual(payWeekSpan(weeks), { fromKey: "2026-10-06", toKey: "2026-11-02" });
  });

  it("knows which days are in a week", () => {
    const week = payWeekOf("2026-10-06");
    assert.ok(inPayWeek(week, "2026-10-06"));
    assert.ok(inPayWeek(week, "2026-10-12"));
    assert.ok(!inPayWeek(week, "2026-10-05"), "that day belongs to the week before");
    assert.ok(!inPayWeek(week, "2026-10-13"));
  });
});

describe("what a period is paid in", () => {
  it("leaves a monthly salary as the month it always was", () => {
    const slices = paySlices("MONTHLY", MONTH, "2026-10-28");
    assert.equal(slices.length, 1);
    assert.deepEqual(slices[0], { fromKey: "2026-10-01", toKey: "2026-10-31", week: null });
  });

  it("gives a weekly salary a row for each week that has begun", () => {
    // Four Tuesdays in October, three of them past on the 20th.
    const slices = paySlices("WEEKLY", MONTH, "2026-10-20");
    assert.deepEqual(
      slices.map((slice) => slice.fromKey),
      ["2026-10-06", "2026-10-13", "2026-10-20"]
    );
    assert.ok(slices.every((slice) => slice.week !== null));
  });

  it("does not list a week nobody has worked a day of", () => {
    // A week with no days behind it has no figure to show, and a pay sheet
    // that lists one has invented a week's salary.
    assert.equal(paySlices("WEEKLY", MONTH, "2026-10-05").length, 0);
    assert.equal(paySlices("WEEKLY", MONTH, "2026-10-31").length, 4, "a month gone by has all of them");
  });
});
