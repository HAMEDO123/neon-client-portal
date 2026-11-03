import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  attendanceSheetCsv,
  buildAttendanceSheet,
  type SheetPerson,
  type SheetRecord,
} from "../src/lib/attendance-sheet";
import { DEFAULT_WORK_HOURS, type WorkHours } from "../src/lib/work-hours";

// Amman is UTC+3 all year, so 11:00 there is 08:00 Z. The studio works
// 11:00–19:00, Sunday to Thursday and Saturday; Friday is closed.
const TZ = "Asia/Amman";
const hours: WorkHours = DEFAULT_WORK_HOURS;

// October 2026: the 1st is a Thursday, the 2nd a Friday (closed), the 3rd a
// Saturday (worked, and it ends an hour early).
const MONTH = "2026-10";
const THURSDAY = "2026-10-01";
const FRIDAY = "2026-10-02";

const salaried: SheetPerson = {
  id: "e1",
  name: "Sally",
  role: "Designer",
  openHours: false,
  // 300 ÷ 26 ÷ 8 — the studio's own rate, so the money on a line is the real one.
  hourlyRate: 1.4423,
};

const hourly: SheetPerson = { id: "e2", name: "Salem", role: null, openHours: true, hourlyRate: 1.5625 };

/** A day as the database holds it: instants in UTC, hours as they were charged. */
const record = (over: Partial<SheetRecord> & { dayKey: string }): SheetRecord => ({
  employeeId: "e1",
  arrivedAt: null,
  departedAt: null,
  breaks: [],
  delayHours: 0,
  earlyHours: 0,
  awayHours: 0,
  shortHours: 0,
  source: "DEVICE",
  note: null,
  ...over,
});

const at = (dayKey: string, utcTime: string) => new Date(`${dayKey}T${utcTime}:00.000Z`);

const build = (people: SheetPerson[], records: SheetRecord[], todayKey = "2026-10-03") =>
  buildAttendanceSheet({ monthKey: MONTH, hours, timeZone: TZ, todayKey, people, records });

describe("a month sheet", () => {
  it("writes a line for every day up to today and none for the days after", () => {
    const sheet = build([salaried], []);
    assert.equal(sheet.people[0].days.length, 3, "the 1st, 2nd and 3rd — not the whole month");
    assert.deepEqual(
      sheet.people[0].days.map((day) => day.dayKey),
      [THURSDAY, FRIDAY, "2026-10-03"]
    );
  });

  it("tells the studio being shut apart from a day it knows nothing about", () => {
    // The platform cannot tell "did not come" from "the device did not read
    // them", so a working day with no row says exactly that and no more.
    const [thursday, friday] = build([salaried], []).people[0].days;
    assert.equal(friday.status, "closed");
    assert.equal(friday.reason, "Studio closed.");
    assert.equal(thursday.status, "none");
    assert.equal(thursday.reason, "Nothing recorded for this day.");
  });

  it("says when the day was owed until, and that nothing is off when it was worked", () => {
    // In at 11:52 — an hour late — so the day owes until 20:00, and leaving at
    // 21:41 settles it. This is the case the owner asked about: late in, late
    // out, nothing charged.
    const sheet = build(
      [salaried],
      [
        record({
          dayKey: THURSDAY,
          arrivedAt: at(THURSDAY, "08:52"),
          departedAt: at(THURSDAY, "18:41"),
          delayHours: 1,
          shortHours: 0,
        }),
      ]
    );

    const day = sheet.people[0].days[0];
    assert.equal(day.status, "worked");
    assert.equal(day.arrived, "11:52 AM");
    assert.equal(day.left, "9:41 PM");
    assert.equal(day.owedUntil, "8:00 PM", "an hour late moves the end an hour");
    assert.equal(day.lateHours, 1);
    assert.equal(day.hoursOff, 0);
    assert.equal(day.moneyOff, 0);
    assert.equal(day.worked, 8, "capped at the studio's own day — there is no overtime");
    assert.equal(day.onSite, 9.82);
    assert.match(day.reason, /1 h late, so the day owed until 8:00 PM/);
    assert.match(day.reason, /nothing off/);
  });

  it("prices the hours a day fell short", () => {
    const sheet = build(
      [salaried],
      [
        record({
          dayKey: THURSDAY,
          arrivedAt: at(THURSDAY, "10:04"),
          departedAt: at(THURSDAY, "16:54"),
          delayHours: 3,
          shortHours: 3,
        }),
      ]
    );

    const day = sheet.people[0].days[0];
    assert.equal(day.lateHours, 3, "1:04 PM, with no allowance in the defaults");
    assert.equal(day.owedUntil, "10:00 PM", "three hours late, so the day owed until ten");
    assert.equal(day.hoursOff, 3);
    assert.equal(day.moneyOff, 4.327, "three hours at the studio's own rate");
    assert.match(day.reason, /left 7:54 PM, 3 h short/);
  });

  it("charges nothing for a day nobody clocked out of, and says so", () => {
    const sheet = build(
      [salaried],
      [record({ dayKey: THURSDAY, arrivedAt: at(THURSDAY, "08:02"), delayHours: 0, shortHours: 0 })]
    );

    const day = sheet.people[0].days[0];
    assert.equal(day.worked, null, "an unknown, not a short day");
    assert.equal(day.hoursOff, 0);
    assert.match(day.reason, /No clock-out recorded, so nothing is charged/);
    assert.equal(sheet.people[0].totals.daysWithoutClockOut, 1);
    assert.equal(sheet.people[0].totals.daysComplete, 0);
  });

  it("measures somebody paid by the hour against nothing but the hours", () => {
    // No end to owe: the day is what was worked, up to the studio's eight.
    const sheet = build(
      [hourly],
      [
        record({
          employeeId: "e2",
          dayKey: THURSDAY,
          arrivedAt: at(THURSDAY, "08:00"),
          departedAt: at(THURSDAY, "18:00"),
        }),
      ]
    );

    const day = sheet.people[0].days[0];
    assert.equal(day.worked, 8);
    assert.equal(day.onSite, 10);
    assert.match(day.reason, /Paid by the hour/);
    assert.match(day.reason, /there is no overtime/);
    // No end to owe and no lateness: they are paid for the hours, so printing
    // either would hold them to a rule the studio does not apply to them.
    assert.equal(day.owedUntil, "");
    assert.equal(day.lateHours, 0);
  });

  it("takes a step-out off the day and pushes the end back by it", () => {
    const sheet = build(
      [salaried],
      [
        record({
          dayKey: THURSDAY,
          arrivedAt: at(THURSDAY, "08:00"),
          departedAt: at(THURSDAY, "16:00"),
          breaks: [{ out: "14:00", back: "14:40" }],
          awayHours: 1,
          shortHours: 1,
        }),
      ]
    );

    const day = sheet.people[0].days[0];
    assert.equal(day.steppedOut, "14:00");
    assert.equal(day.steppedBack, "14:40");
    assert.equal(day.owedUntil, "8:00 PM", "forty minutes out is charged as an hour, so it gives an hour back");
    assert.equal(day.worked, 7);
    assert.match(day.reason, /Out and back once, 1 h\./);
  });

  it("says so when the times and the figure charged disagree", () => {
    // A row written before the rule changed, or hours edited since. The sheet
    // explains the deduction that is on the payslip, not the one it would make
    // today — and the difference is the half worth reading.
    const sheet = build(
      [salaried],
      [
        record({
          dayKey: THURSDAY,
          arrivedAt: at(THURSDAY, "08:00"),
          departedAt: at(THURSDAY, "16:00"),
          shortHours: 2,
          source: "MANUAL",
        }),
      ]
    );

    const day = sheet.people[0].days[0];
    assert.equal(day.hoursOff, 2, "what payroll took is what the row says");
    assert.match(day.reason, /the day was worked, nothing off/);
    assert.match(day.reason, /Charged as 2 h off, not 0 h\./);
  });

  it("keeps a figure typed by hand as what it is", () => {
    // No times to measure, so the manager's figure is the whole record of it.
    const sheet = build([salaried], [record({ dayKey: THURSDAY, source: "MANUAL", shortHours: 3, note: "Left at noon" })]);

    const day = sheet.people[0].days[0];
    assert.equal(day.status, "typed");
    assert.equal(day.owedUntil, "");
    assert.equal(day.hoursOff, 3);
    assert.match(day.reason, /No times recorded — 3 h off as entered by hand/);
    assert.equal(day.note, "Left at noon");
  });

  it("totals the column above it", () => {
    const sheet = build(
      [salaried],
      [
        record({ dayKey: THURSDAY, arrivedAt: at(THURSDAY, "08:00"), departedAt: at(THURSDAY, "16:00") }),
        record({
          dayKey: "2026-10-03",
          arrivedAt: at("2026-10-03", "10:00"),
          departedAt: at("2026-10-03", "15:00"),
          delayHours: 2,
          shortHours: 2,
        }),
      ]
    );

    const { totals } = sheet.people[0];
    assert.equal(totals.daysRecorded, 2);
    assert.equal(totals.daysComplete, 2);
    assert.equal(totals.hoursWorked, 13);
    assert.equal(totals.hoursOff, 2);
    assert.equal(totals.moneyOff, 2.885);
  });
});

describe("the sheet as a spreadsheet", () => {
  const sheet = () =>
    build(
      [salaried],
      [
        record({
          dayKey: THURSDAY,
          arrivedAt: at(THURSDAY, "08:52"),
          departedAt: at(THURSDAY, "18:41"),
          delayHours: 1,
          note: 'Owner said "fine"',
        }),
      ]
    );

  it("opens as UTF-8 in Excel rather than as a guess", () => {
    const csv = attendanceSheetCsv(sheet());
    assert.ok(csv.startsWith("﻿"), "the mark goes on the front of the file");
    assert.ok(csv.includes("\r\n"), "and the line endings Excel expects");
  });

  it("carries the day's working and its totals", () => {
    const csv = attendanceSheetCsv(sheet());
    assert.match(csv, /Employee,Role,Date,Day,Status,In,Step out,Step back,Out,Worked \(h\)/);
    assert.match(csv, /Sally,Designer,2026-10-01,Thu,Worked,11:52 AM/);
    assert.match(csv, /Days without clock-out/, "the totals table follows the days");
  });

  it("quotes a cell that would otherwise split the row", () => {
    const csv = attendanceSheetCsv(sheet());
    assert.match(csv, /"Owner said ""fine"""/);
  });

  it("defuses a note that looks like a formula", () => {
    // Notes are typed by people. A spreadsheet that runs what it was handed can
    // be made to do anything by anybody who can write one.
    const csv = attendanceSheetCsv(
      build([salaried], [record({ dayKey: THURSDAY, note: "=1+1", source: "MANUAL", shortHours: 1 })])
    );
    assert.ok(csv.includes("'=1+1"), "an apostrophe Excel eats on opening");
    assert.ok(!csv.includes(",=1+1"), "and never a live formula");
  });
});
