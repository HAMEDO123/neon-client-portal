import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  daysBetween,
  moveSpanTo,
  placeInWeek,
  stackRows,
  weekDayKeys,
  weekLabel,
  weekStartKey,
} from "../src/lib/week";

// 2026-09-06 is a Sunday, so this week runs Sun 6 to Sat 12.
const WEEK = weekDayKeys("2026-09-09");

describe("the working week", () => {
  it("starts on Sunday, which is where the week here starts", () => {
    assert.equal(weekStartKey("2026-09-09"), "2026-09-06");
    // A Sunday is already the start of its own week.
    assert.equal(weekStartKey("2026-09-06"), "2026-09-06");
    // And a Saturday is the end of one, not the start of the next.
    assert.equal(weekStartKey("2026-09-12"), "2026-09-06");
  });

  it("lays out seven days", () => {
    assert.equal(WEEK.length, 7);
    assert.deepEqual(WEEK, [
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
    ]);
  });

  it("counts days between two of them", () => {
    assert.equal(daysBetween("2026-09-06", "2026-09-09"), 3);
    assert.equal(daysBetween("2026-09-09", "2026-09-06"), -3);
    assert.equal(daysBetween("2026-09-09", "2026-09-09"), 0);
  });

  it("reads a week as a heading, and says both months when it spans two", () => {
    assert.equal(weekLabel(WEEK), "6 – 12 Sep");
    assert.equal(weekLabel(weekDayKeys("2026-10-01")), "27 Sep – 3 Oct");
  });
});

describe("where a job sits on the week", () => {
  it("fills exactly the days it runs over", () => {
    // Two days to go and negotiate: two cells, starting on the Monday.
    const place = placeInWeek({ startKey: "2026-09-07", endKey: "2026-09-08" }, WEEK);
    assert.deepEqual(place, { startColumn: 1, span: 2, continuesBefore: false, continuesAfter: false });
  });

  it("fills one cell for a one-day job", () => {
    const place = placeInWeek({ startKey: "2026-09-09", endKey: "2026-09-09" }, WEEK);
    assert.equal(place?.span, 1);
    assert.equal(place?.startColumn, 3);
  });

  it("clips a job that runs in from the week before, and says it does", () => {
    const place = placeInWeek({ startKey: "2026-09-03", endKey: "2026-09-08" }, WEEK);
    assert.equal(place?.startColumn, 0);
    assert.equal(place?.span, 3);
    assert.equal(place?.continuesBefore, true);
    assert.equal(place?.continuesAfter, false);
  });

  it("clips one running out into the next week", () => {
    const place = placeInWeek({ startKey: "2026-09-11", endKey: "2026-09-20" }, WEEK);
    assert.equal(place?.startColumn, 5);
    assert.equal(place?.span, 2);
    assert.equal(place?.continuesAfter, true);
  });

  it("covers the whole row for a job that swallows the week", () => {
    const place = placeInWeek({ startKey: "2026-09-01", endKey: "2026-09-30" }, WEEK);
    assert.deepEqual(place, { startColumn: 0, span: 7, continuesBefore: true, continuesAfter: true });
  });

  it("leaves out a job that misses the week entirely", () => {
    assert.equal(placeInWeek({ startKey: "2026-08-01", endKey: "2026-08-05" }, WEEK), null);
    assert.equal(placeInWeek({ startKey: "2026-10-01", endKey: "2026-10-05" }, WEEK), null);
  });
});

describe("stacking overlapping jobs", () => {
  it("keeps two jobs on the same days off each other", () => {
    const rows = stackRows([
      { id: "a", startKey: "2026-09-07", endKey: "2026-09-09" },
      { id: "b", startKey: "2026-09-08", endKey: "2026-09-10" },
    ]);

    assert.deepEqual(
      rows.map((row) => ({ id: (row.item as { id: string }).id, row: row.row })),
      [
        { id: "a", row: 0 },
        { id: "b", row: 1 },
      ]
    );
  });

  it("reuses a row once it is free again", () => {
    const rows = stackRows([
      { id: "a", startKey: "2026-09-06", endKey: "2026-09-07" },
      { id: "b", startKey: "2026-09-09", endKey: "2026-09-10" },
    ]);

    // Nothing overlaps, so both sit on the first row rather than stacking.
    assert.deepEqual(rows.map((row) => row.row), [0, 0]);
  });

  it("needs three rows for three jobs on the same day", () => {
    const rows = stackRows([
      { id: "a", startKey: "2026-09-08", endKey: "2026-09-08" },
      { id: "b", startKey: "2026-09-08", endKey: "2026-09-09" },
      { id: "c", startKey: "2026-09-08", endKey: "2026-09-10" },
    ]);

    assert.deepEqual([...new Set(rows.map((row) => row.row))].sort(), [0, 1, 2]);
  });
});

describe("dragging a job to another day", () => {
  const twoDay = { startKey: "2026-09-07", endKey: "2026-09-08" };

  it("keeps its length — picking it up says when, not how long", () => {
    const moved = moveSpanTo(twoDay, "2026-09-10");
    assert.equal(moved.startKey, "2026-09-10");
    assert.equal(moved.endKey, "2026-09-11");
    assert.equal(daysBetween(moved.startKey, moved.endKey), daysBetween(twoDay.startKey, twoDay.endKey));
  });

  it("moves backwards as readily as forwards", () => {
    const moved = moveSpanTo(twoDay, "2026-09-06");
    assert.equal(moved.days, -1);
    assert.deepEqual([moved.startKey, moved.endKey], ["2026-09-06", "2026-09-07"]);
  });

  it("is a no-op when dropped where it already was", () => {
    const moved = moveSpanTo(twoDay, twoDay.startKey);
    assert.equal(moved.days, 0);
    assert.deepEqual([moved.startKey, moved.endKey], [twoDay.startKey, twoDay.endKey]);
  });

  it("carries a one-day job to exactly one day", () => {
    const moved = moveSpanTo({ startKey: "2026-09-09", endKey: "2026-09-09" }, "2026-09-12");
    assert.equal(moved.startKey, moved.endKey);
    assert.equal(moved.startKey, "2026-09-12");
  });

  it("crosses a month end without losing a day", () => {
    const moved = moveSpanTo({ startKey: "2026-09-29", endKey: "2026-09-30" }, "2026-10-01");
    assert.deepEqual([moved.startKey, moved.endKey], ["2026-10-01", "2026-10-02"]);
  });

  it("lands where the week view will draw it", () => {
    const moved = moveSpanTo(twoDay, "2026-09-11");
    const place = placeInWeek(moved, WEEK);
    assert.equal(place?.startColumn, 5);
    assert.equal(place?.span, 2);
  });
});
