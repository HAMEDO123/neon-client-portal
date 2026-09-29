import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  countThrough,
  daysInMonth,
  existedAt,
  monthSeries,
  openAt,
  shiftPeriod,
  weekOfMonth,
  weeklyCounts,
  weeksInMonth,
} from "@/lib/mobile/home-pulse-rules";

// The Home tab's small charts. Each count must come from a recorded moment,
// and a month still running must only ever be compared with the same days of
// the month before.

describe("weeks of a month", () => {
  it("counts from the 1st, with a short fifth week", () => {
    assert.equal(weekOfMonth(1), 1);
    assert.equal(weekOfMonth(7), 1);
    assert.equal(weekOfMonth(8), 2);
    assert.equal(weekOfMonth(28), 4);
    assert.equal(weekOfMonth(29), 5);
    assert.equal(weekOfMonth(31), 5);
  });

  it("gives February four weeks and a 30-day month five", () => {
    assert.equal(daysInMonth("2026-02"), 28);
    assert.equal(weeksInMonth("2026-02"), 4);
    assert.equal(daysInMonth("2028-02"), 29);
    assert.equal(weeksInMonth("2028-02"), 5);
    assert.equal(weeksInMonth("2026-09"), 5);
  });

  it("turns a year over", () => {
    assert.equal(shiftPeriod("2026-01", -1), "2025-12");
    assert.equal(shiftPeriod("2026-12", 1), "2027-01");
    assert.equal(shiftPeriod("2026-09", -4), "2026-05");
  });
});

describe("counting days into weeks", () => {
  const keys = ["2026-09-01", "2026-09-07", "2026-09-08", "2026-09-30", "2026-08-31", "2026-10-01"];

  it("puts each day in its week and ignores other months", () => {
    assert.deepEqual(weeklyCounts(keys, "2026-09"), [2, 1, 0, 0, 1]);
    assert.deepEqual(weeklyCounts(keys, "2026-08"), [0, 0, 0, 0, 1]);
  });

  it("counts a month only through a given day", () => {
    assert.equal(countThrough(keys, "2026-09", 7), 2);
    assert.equal(countThrough(keys, "2026-09", 30), 4);
  });
});

describe("this month against last month", () => {
  it("compares a running month with the same days of the last one", () => {
    const keys = ["2026-08-02", "2026-08-20", "2026-08-31", "2026-09-03"];
    const series = monthSeries(keys, "2026-09-10");
    assert.equal(series.period, "2026-09");
    assert.equal(series.previousPeriod, "2026-08");
    assert.equal(series.total, 1);
    // Only the 2nd of August is on or before the 10th.
    assert.equal(series.previousToDate, 1);
    assert.equal(series.previousTotal, 3);
    assert.deepEqual(series.previousWeeks, [1, 0, 1, 0, 1]);
  });

  it("stops at the last day of a shorter month before", () => {
    const series = monthSeries(["2026-02-28", "2026-03-31"], "2026-03-31");
    assert.equal(series.previousToDate, 1);
    assert.equal(series.total, 1);
  });
});

describe("history of a count", () => {
  const at = (iso: string) => new Date(iso);

  it("counts what existed at each moment", () => {
    const created = [at("2026-07-10T10:00:00Z"), at("2026-09-02T10:00:00Z")];
    assert.deepEqual(existedAt(created, [at("2026-07-01T00:00:00Z"), at("2026-08-01T00:00:00Z"), at("2026-09-30T00:00:00Z")]), [0, 1, 2]);
  });

  it("holds an approval open from asking until the answer, and an unanswered one for good", () => {
    const spans = [
      { from: at("2026-09-01T09:00:00Z"), to: at("2026-09-10T09:00:00Z") },
      { from: at("2026-09-05T09:00:00Z"), to: null },
    ];
    const moments = [at("2026-08-31T00:00:00Z"), at("2026-09-06T00:00:00Z"), at("2026-09-10T09:00:00Z"), at("2026-09-20T00:00:00Z")];
    assert.deepEqual(openAt(spans, moments), [0, 2, 1, 1]);
  });
});
