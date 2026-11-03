import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  nextPeriod,
  periodBounds,
  periodDayKeys,
  periodFirstDayKey,
  periodLastDayKey,
  periodOf,
  periodRangeLabel,
  PERIOD_START_DAY,
  priorPeriod,
} from "../src/lib/pay-period";
import { periodRange, previousPeriod, receiptPeriod } from "../src/lib/payroll";

// Where a pay period begins and ends (lib/pay-period.ts).
//
// The studio settles **5th to 4th** and always has. The platform read a
// calendar month everywhere, and the two only looked the same until the owner
// opened the pay sheet on 3 November 2026 and found it near empty — four days
// of work under a month that had barely begun, while the month he was settling
// sat behind "Previous month" looking finished. His words were "ليش صفرت
// الحساب انت كله؟": why did you zero the whole account.
//
// Nothing had been zeroed. The boundary was wrong, and a wrong boundary is the
// kind of bug that reads as missing money, which is worse than reading as a
// bug. So the rules it has to keep are written out here rather than left to
// the places that depend on them.

describe("which period a day belongs to", () => {
  it("starts a new period on the 5th", () => {
    assert.equal(PERIOD_START_DAY, 5);
    assert.equal(periodOf("2026-10-05"), "2026-10");
    assert.equal(periodOf("2026-10-31"), "2026-10");
    assert.equal(periodOf("2026-11-04"), "2026-10", "4 November is still October's pay");
    assert.equal(periodOf("2026-11-05"), "2026-11");
  });

  it("puts the first four days of a month in the period before", () => {
    // The days the old boundary got wrong, and the reason the sheet looked
    // empty: on the 3rd, the period being worked began on the 5th before.
    assert.equal(periodOf("2026-11-01"), "2026-10");
    assert.equal(periodOf("2026-11-03"), "2026-10");
  });

  it("crosses a year without a special case", () => {
    assert.equal(periodOf("2026-01-04"), "2025-12");
    assert.equal(periodOf("2026-01-05"), "2026-01");
    assert.equal(periodOf("2026-12-31"), "2026-12");
    assert.equal(periodOf("2027-01-01"), "2026-12");
  });
});

describe("the days a period covers", () => {
  it("runs the 5th to the 4th", () => {
    assert.equal(periodFirstDayKey("2026-10"), "2026-10-05");
    assert.equal(periodLastDayKey("2026-10"), "2026-11-04");
    assert.deepEqual(periodBounds("2026-10"), { from: "2026-10-05", to: "2026-11-04" });

    const days = periodDayKeys("2026-10");
    assert.equal(days[0], "2026-10-05");
    assert.equal(days.at(-1), "2026-11-04");
    assert.equal(days.length, 31);
  });

  it("gives every day exactly one period, and no day two", () => {
    // The property the money rests on. Checked across a whole year rather
    // than at a chosen boundary, because the way this breaks is one month in
    // twelve — February, or the one after a 31-day month.
    const seen = new Map<string, string>();

    for (let month = 1; month <= 12; month++) {
      const period = `2026-${String(month).padStart(2, "0")}`;
      for (const day of periodDayKeys(period)) {
        assert.equal(seen.get(day), undefined, `${day} is in two periods`);
        seen.set(day, period);
        assert.equal(periodOf(day), period, `${day} is listed under ${period} but reads as ${periodOf(day)}`);
      }
    }

    // 5 Jan 2026 through 4 Jan 2027, with nothing missing in between.
    assert.equal(seen.size, 365);
  });

  it("gets February right, leap year and not", () => {
    assert.equal(periodDayKeys("2026-02").length, 28, "5 Feb – 4 Mar 2026");
    assert.equal(periodDayKeys("2028-02").length, 29, "5 Feb – 4 Mar 2028");
    assert.equal(periodLastDayKey("2028-02"), "2028-03-04");
  });

  it("answers nothing for a period it cannot read, rather than a guess", () => {
    assert.deepEqual(periodDayKeys("not-a-month"), []);
    assert.deepEqual(periodDayKeys(""), []);
  });
});

describe("stepping between periods", () => {
  it("moves by one month, over a year boundary either way", () => {
    assert.equal(nextPeriod("2026-11"), "2026-12");
    assert.equal(nextPeriod("2026-12"), "2027-01");
    assert.equal(priorPeriod("2026-01"), "2025-12");
    assert.equal(priorPeriod("2026-11"), "2026-10");
    assert.equal(previousPeriod("2026-01"), "2025-12");
  });

  it("names a period's instants as the 5th to the next 5th, half open", () => {
    // Half open so a `gte` / `lt` pair covers the period exactly: an inclusive
    // end at midnight would take the whole of the 4th or none of it depending
    // on which comparison the caller reached for.
    const { start, end } = periodRange("2026-10");
    assert.equal(start.toISOString(), "2026-10-05T00:00:00.000Z");
    assert.equal(end.toISOString(), "2026-11-05T00:00:00.000Z");
  });
});

describe("what a period is called on screen", () => {
  it("says the dates it covers, not only the month's name", () => {
    // "October" on its own is what let a 5th-to-4th period read as a calendar
    // one, so every heading that names a period shows this beside it.
    assert.equal(periodRangeLabel("2026-10"), "5 Oct – 4 Nov 2026");
    assert.equal(periodRangeLabel("2026-12"), "5 Dec – 4 Jan 2027");
  });
});

describe("a receipt follows the same boundary", () => {
  it("counts in the period it was sent in", () => {
    // It has to be the same answer as the pay sheet's, or a receipt is filed
    // under a period whose pay is already settled and nobody is paid for it.
    for (const day of ["2026-10-05", "2026-10-31", "2026-11-04", "2026-11-05"]) {
      assert.equal(receiptPeriod(day), periodOf(day), day);
    }
  });
});
