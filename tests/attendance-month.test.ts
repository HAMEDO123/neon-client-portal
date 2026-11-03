import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildMonth,
  monthBounds,
  monthDayKeys,
  monthKeyFor,
  monthLabel,
  shiftMonth,
  type MonthEntry,
} from "../src/lib/attendance-month";
import { DEFAULT_WORK_HOURS, type WorkHours } from "../src/lib/work-hours";
import { DEVICE, MANUAL } from "../src/lib/attendance";

// The studio's own week: Sunday to Thursday and Saturday, with Friday off. The
// default is Sunday to Thursday, so using both is what proves the grid reads
// the setting rather than assuming a weekend.
const STUDIO: WorkHours = { ...DEFAULT_WORK_HOURS, days: [0, 1, 2, 3, 4, 6] };
const TODAY = "2026-09-19";

const entry = (
  employeeId: string,
  dayKey: string,
  delayHours = 0,
  source = DEVICE,
  earlyHours = 0,
  clockedOut = true,
  // What the day costs. Defaults to the hours above added up, which is what a
  // day used to be charged and keeps every older case saying what it said.
  shortHours = delayHours + earlyHours
): MonthEntry => ({
  employeeId,
  dayKey,
  delayHours,
  earlyHours,
  awayHours: 0,
  shortHours,
  breaks: [],
  clockedOut,
  source,
  note: null,
});

describe("which month is being looked at", () => {
  it("uses the one it was given", () => {
    assert.equal(monthKeyFor("2026-08", TODAY), "2026-08");
    assert.equal(monthKeyFor("2024-12", TODAY), "2024-12");
  });

  it("falls back to this month for anything it cannot read", () => {
    // Reached from a typed URL or an old link. The obvious screen beats an
    // empty grid from a year nobody asked about.
    assert.equal(monthKeyFor(undefined, TODAY), "2026-09");
    assert.equal(monthKeyFor(null, TODAY), "2026-09");
    assert.equal(monthKeyFor("", TODAY), "2026-09");
    assert.equal(monthKeyFor("last month", TODAY), "2026-09");
    assert.equal(monthKeyFor("2026-9", TODAY), "2026-09", "a real month badly written is still not a month key");
    assert.equal(monthKeyFor("2026-13", TODAY), "2026-09", "there is no thirteenth month");
    assert.equal(monthKeyFor("2026-00", TODAY), "2026-09");
    assert.equal(monthKeyFor("2026-09-19", TODAY), "2026-09", "a day is not a month");
  });
});

describe("the days of a month, which is the 5th to the 4th", () => {
  // The studio settles 5th-to-4th and always did (lib/pay-period.ts). The
  // platform read a calendar month until 2026-11-03, and the two only looked
  // alike until the pay sheet was opened on the 3rd of a month and showed four
  // days of work under a month that had barely started.
  it("runs from the 5th to the 4th of the next month", () => {
    const days = monthDayKeys("2026-09");
    assert.equal(days.length, 30, "5 Sep to 4 Oct");
    assert.equal(days[0], "2026-09-05");
    assert.equal(days.at(-1), "2026-10-04");
  });

  it("gets February right, leap year and not", () => {
    // The length is the gap between two 5ths, so February's own length is what
    // makes these differ — 5 Feb to 4 Mar is 28 days in 2026 and 29 in 2028.
    assert.equal(monthDayKeys("2026-02").length, 28);
    assert.equal(monthDayKeys("2028-02").length, 29);
    assert.equal(monthDayKeys("2028-02").at(-1), "2028-03-04");
  });

  it("crosses a year boundary without a special case", () => {
    const december = monthDayKeys("2026-12");
    assert.equal(december[0], "2026-12-05");
    assert.equal(december.at(-1), "2027-01-04");
  });

  it("pads single digits, so every day is a key", () => {
    assert.equal(monthDayKeys("2026-01")[0], "2026-01-05");
    assert.equal(monthDayKeys("2026-01")[4], "2026-01-09");
  });

  it("gives every day exactly one month, with no day in two", () => {
    // The property that matters for money: a day counted twice is a day paid
    // twice, and a day in neither is a day nobody is paid for.
    const january = new Set(monthDayKeys("2025-12"));
    const february = monthDayKeys("2026-01");

    assert.ok(january.has("2026-01-04"), "4 January belongs to December");
    assert.ok(!january.has("2026-01-05"), "5 January does not");
    assert.equal(february[0], "2026-01-05");
    assert.equal(february.filter((day) => january.has(day)).length, 0);
  });

  it("names the first and last day for a query", () => {
    assert.deepEqual(monthBounds("2026-02"), { from: "2026-02-05", to: "2026-03-04" });
  });
});

describe("moving between months", () => {
  it("steps back and forward", () => {
    assert.equal(shiftMonth("2026-09", -1), "2026-08");
    assert.equal(shiftMonth("2026-09", 1), "2026-10");
  });

  it("crosses a year boundary in both directions", () => {
    // Written as arithmetic on a real date rather than on the number, because
    // "month 0" and "month 13" are exactly where a hand-rolled version breaks.
    assert.equal(shiftMonth("2026-01", -1), "2025-12");
    assert.equal(shiftMonth("2026-12", 1), "2027-01");
  });

  it("says the month in words", () => {
    assert.equal(monthLabel("2026-09"), "September 2026");
    assert.equal(monthLabel("2026-01"), "January 2026");
  });
});

describe("the month grid", () => {
  const people = [
    { id: "e1", name: "Salem", active: true },
    { id: "e2", name: "Hamed", active: true },
  ];

  it("puts each day in its own column, in order", () => {
    const month = buildMonth({
      monthKey: "2026-09",
      hours: STUDIO,
      todayKey: TODAY,
      people,
      entries: [entry("e1", "2026-09-19", 0), entry("e1", "2026-09-17", 1.5)],
    });

    const salem = month.rows[0];
    // The month runs 5 Sep to 4 Oct (lib/pay-period.ts), so the 5th is column
    // 0 and the 17th is column 12.
    assert.equal(month.days.length, 30);
    assert.equal(salem.cells.length, 30, "a cell for every day, so nothing can shift a column");
    assert.equal(month.days[0].dayKey, "2026-09-05");
    assert.equal(salem.cells[12]?.dayKey, "2026-09-17");
    assert.equal(salem.cells[12]?.delayHours, 1.5);
    assert.equal(salem.cells[14]?.dayKey, "2026-09-19");
    assert.equal(salem.cells[13], null, "the 18th has no record");
  });

  it("marks the days the studio works from the settings, not from a weekend", () => {
    const month = buildMonth({ monthKey: "2026-09", hours: STUDIO, todayKey: TODAY, people, entries: [] });
    const on = (dayKey: string) => month.days.find((day) => day.dayKey === dayKey);

    assert.equal(on("2026-09-18")?.worked, false, "Friday, the day nobody works");
    assert.equal(on("2026-09-19")?.worked, true, "Saturday, which this studio does work");
    assert.equal(on("2026-09-17")?.worked, true, "Thursday");

    // The same month read against the default week, where Saturday is not
    // worked — so this follows Settings rather than a weekend written in here.
    const byDefault = buildMonth({
      monthKey: "2026-09",
      hours: DEFAULT_WORK_HOURS,
      todayKey: TODAY,
      people,
      entries: [],
    });
    assert.equal(byDefault.days.find((day) => day.dayKey === "2026-09-19")?.worked, false);
  });

  it("knows today, and what has not happened yet", () => {
    const month = buildMonth({ monthKey: "2026-09", hours: STUDIO, todayKey: TODAY, people, entries: [] });

    assert.equal(month.days.find((day) => day.dayKey === TODAY)?.isToday, true);
    assert.equal(month.days.find((day) => day.dayKey === "2026-09-20")?.isFuture, true);
    assert.equal(month.days.find((day) => day.dayKey === "2026-09-18")?.isFuture, false);
    assert.equal(month.days.filter((day) => day.isToday).length, 1);
  });

  it("gives somebody with nothing recorded a row all the same", () => {
    // A blank row is "nothing was recorded", which is a fact. Leaving the
    // person out would turn it into "nobody works here", which is not.
    const month = buildMonth({
      monthKey: "2026-09",
      hours: STUDIO,
      todayKey: TODAY,
      people,
      entries: [entry("e1", "2026-09-19")],
    });

    const hamed = month.rows[1];
    assert.equal(hamed.name, "Hamed");
    assert.equal(hamed.daysRecorded, 0);
    assert.equal(hamed.hoursLate, 0);
    assert.equal(hamed.cells.every((cell) => cell === null), true);
  });

  it("counts the days recorded and adds up the lateness", () => {
    const month = buildMonth({
      monthKey: "2026-09",
      hours: STUDIO,
      todayKey: TODAY,
      people,
      entries: [
        entry("e1", "2026-09-13", 0.12),
        entry("e1", "2026-09-14", 0.33),
        entry("e1", "2026-09-15", 0),
      ],
    });

    assert.equal(month.rows[0].daysRecorded, 3, "a day on time is still a day recorded");
    // 0.12 + 0.33 is 0.44999999999999996 in binary floating point. A screen
    // beside payroll printing that is a screen nobody trusts.
    assert.equal(month.rows[0].hoursLate, 0.45);
  });

  it("ignores a record from outside the month it was asked for", () => {
    const month = buildMonth({
      monthKey: "2026-09",
      hours: STUDIO,
      todayKey: TODAY,
      people,
      // Both are outside 5 Sep – 4 Oct: the 31st of August belongs to August's
      // period, and 5 October to October's. The 1st of October does *not* —
      // it is inside September's period now, which is the whole point of the
      // boundary and would be missed by a test that only used the old dates.
      entries: [entry("e1", "2026-08-31", 4), entry("e1", "2026-10-05", 4)],
    });

    assert.equal(month.rows[0].daysRecorded, 0);
    assert.equal(month.rows[0].hoursLate, 0, "August's lateness is not September's");
  });

  it("counts the first days of the next calendar month, because they are this period", () => {
    // The other half of the boundary, and the half that would have gone
    // unnoticed: 1 October is September's pay. A test that only checked what
    // falls outside would pass with the period a week too short.
    const month = buildMonth({
      monthKey: "2026-09",
      hours: STUDIO,
      todayKey: "2026-10-04",
      people,
      entries: [entry("e1", "2026-10-01", 2), entry("e1", "2026-10-04", 1)],
    });

    assert.equal(month.rows[0].daysRecorded, 2);
    assert.equal(month.rows[0].hoursLate, 3);
    assert.equal(month.days.at(-1)?.dayKey, "2026-10-04");
  });

  it("keeps what put the figure there, so a typed day can be told apart", () => {
    const month = buildMonth({
      monthKey: "2026-09",
      hours: STUDIO,
      todayKey: TODAY,
      people,
      entries: [entry("e1", "2026-09-17", 0, MANUAL), entry("e2", "2026-09-17", 6.9, DEVICE)],
    });

    assert.equal(month.rows[0].cells[12]?.source, MANUAL);
    assert.equal(month.rows[1].cells[12]?.source, DEVICE);
  });

  it("keeps people in the order it was given them", () => {
    const month = buildMonth({ monthKey: "2026-09", hours: STUDIO, todayKey: TODAY, people, entries: [] });
    assert.deepEqual(month.rows.map((row) => row.name), ["Salem", "Hamed"]);
  });
});
