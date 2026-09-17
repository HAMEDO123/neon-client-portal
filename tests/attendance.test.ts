import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEVICE,
  MANUAL,
  attendanceFromPunches,
  groupPunches,
  lateHours,
  mayDeviceWrite,
  type Punch,
} from "../src/lib/attendance";
import { DEFAULT_WORK_HOURS, type WorkHours } from "../src/lib/work-hours";

// Amman runs at UTC+3 all year, so 11:00 there is 08:00 Z. The studio's default
// day is 11:00–19:00, Sunday to Thursday.
const TZ = "Asia/Amman";
const hours: WorkHours = DEFAULT_WORK_HOURS;

/** A punch at a wall-clock time in Amman, written as the instant it happened. */
const at = (dayKey: string, utcTime: string, deviceUserId = "7"): Punch => ({
  deviceUserId,
  at: new Date(`${dayKey}T${utcTime}:00.000Z`),
});

// 2026-09-17 is a Thursday (worked); 2026-09-18 is a Friday (not).
const THURSDAY = "2026-09-17";
const FRIDAY = "2026-09-18";
const SUNDAY = "2026-09-20";

describe("how late an arrival is", () => {
  it("counts the minutes past the start of the day", () => {
    // 08:30Z is 11:30 in Amman, half an hour after 11:00.
    assert.equal(lateHours(hours, "11:30"), 0.5);
    assert.equal(lateHours(hours, "12:00"), 1);
    assert.equal(lateHours(hours, "11:07"), 0.12);
  });

  it("is nothing at all when somebody is on time", () => {
    assert.equal(lateHours(hours, "11:00"), 0);
  });

  it("never goes negative for somebody who came early", () => {
    // An hour early is not an hour of credit — payroll multiplies this number.
    assert.equal(lateHours(hours, "10:00"), 0);
    assert.equal(lateHours(hours, "07:15"), 0);
  });

  it("forgives what the studio says to forgive, and no more", () => {
    assert.equal(lateHours(hours, "11:05", 10), 0);
    assert.equal(lateHours(hours, "11:10", 10), 0);
    assert.equal(lateHours(hours, "11:25", 10), 0.25);
  });

  it("refuses a time it cannot read rather than guessing", () => {
    assert.equal(lateHours(hours, "not a time"), 0);
    assert.equal(lateHours(hours, ""), 0);
  });
});

describe("grouping what the device reports", () => {
  it("puts a person's punches under the day they happened in Amman, not in UTC", () => {
    // 21:30Z on Thursday is 00:30 Friday in Amman — a different day, and at the
    // end of a month a different payslip.
    const grouped = groupPunches([at(THURSDAY, "21:30")], TZ);
    assert.deepEqual([...grouped.keys()], ["7|2026-09-18"]);
  });

  it("keeps two people's days apart", () => {
    const grouped = groupPunches([at(THURSDAY, "08:00", "7"), at(THURSDAY, "08:00", "9")], TZ);
    assert.equal(grouped.size, 2);
  });

  it("ignores a timestamp that is not a date", () => {
    const grouped = groupPunches(
      [{ deviceUserId: "7", at: new Date("nonsense") }, at(THURSDAY, "08:00")],
      TZ
    );
    assert.equal(grouped.size, 1);
  });
});

describe("a day's attendance from punches", () => {
  it("takes the first read of the day as the arrival", () => {
    const days = attendanceFromPunches(
      [at(THURSDAY, "13:00"), at(THURSDAY, "08:20"), at(THURSDAY, "16:00")],
      hours,
      TZ
    );

    assert.equal(days.length, 1);
    assert.equal(days[0].punches, 3);
    assert.equal(days[0].delayHours, 0.33, "11:20 is twenty minutes late");
    assert.equal(days[0].arrivedAt.toISOString(), `${THURSDAY}T08:20:00.000Z`);
    assert.equal(days[0].lastAt.toISOString(), `${THURSDAY}T16:00:00.000Z`);
  });

  it("still counts a day somebody only touched once", () => {
    const days = attendanceFromPunches([at(THURSDAY, "09:00")], hours, TZ);
    assert.equal(days[0].punches, 1);
    assert.equal(days[0].delayHours, 1);
  });

  it("says nothing about a day the studio is closed", () => {
    // Nobody is late for a Friday. A zero row would still count as a day of
    // attendance on the payroll screen.
    assert.deepEqual(attendanceFromPunches([at(FRIDAY, "08:00")], hours, TZ), []);
  });

  it("separates the same person's different days", () => {
    const days = attendanceFromPunches([at(SUNDAY, "08:00"), at(THURSDAY, "09:30")], hours, TZ);
    assert.deepEqual(
      days.map((day) => [day.dayKey, day.delayHours]),
      [
        ["2026-09-17", 1.5],
        ["2026-09-20", 0],
      ]
    );
  });

  it("returns nothing for nothing", () => {
    assert.deepEqual(attendanceFromPunches([], hours, TZ), []);
  });
});

describe("what a sync is allowed to overwrite", () => {
  it("writes a day nobody has recorded yet", () => {
    assert.equal(mayDeviceWrite(null), true);
    assert.equal(mayDeviceWrite(undefined), true);
  });

  it("updates a row it wrote itself", () => {
    assert.equal(mayDeviceWrite(DEVICE), true);
  });

  it("never touches a figure the manager typed", () => {
    // Somebody typed it because the device was wrong, off, or the person was on
    // site. Overwriting it would undo a correction silently, in the table that
    // decides pay.
    assert.equal(mayDeviceWrite(MANUAL), false);
  });

  it("leaves alone anything it does not recognise", () => {
    assert.equal(mayDeviceWrite("IMPORTED"), false);
  });
});
