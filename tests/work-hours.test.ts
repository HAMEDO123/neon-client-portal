import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_WORK_HOURS,
  capacityMinutes,
  isWorkingDay,
  isWorkingTime,
  minutesOf,
  nextWorkingDay,
  nextWorkingMoment,
  parseWorkHours,
  remainingMinutes,
  spanMinutes,
  timeOf,
  weekdayOf,
  type WorkHours,
} from "../src/lib/work-hours";

// The working day these rules describe: 11:00 to 19:00, half an hour for lunch
// at 14:00, Sunday to Thursday. Everything the planner and the follow-ups do is
// measured against this, so it is pinned down here rather than assumed.

const hours: WorkHours = DEFAULT_WORK_HOURS;

describe("the shape of the working day", () => {
  it("runs 11:00 to 19:00 and holds 450 minutes after a half-hour lunch", () => {
    assert.equal(hours.start, "11:00");
    assert.equal(hours.end, "19:00");
    assert.equal(hours.lunchMinutes, 30);
    assert.equal(spanMinutes(hours), 480);
    assert.equal(capacityMinutes(hours), 450);
  });

  it("keeps back whatever margin is set for the day going wrong", () => {
    assert.equal(capacityMinutes({ ...hours, bufferMinutes: 45 }), 405);
  });

  it("reads a time both ways", () => {
    assert.equal(minutesOf("11:00"), 660);
    assert.equal(minutesOf("9:05"), 545);
    assert.equal(minutesOf("24:00"), null);
    assert.equal(minutesOf("not a time"), null);
    assert.equal(timeOf(660), "11:00");
    assert.equal(timeOf(545), "09:05");
  });
});

describe("reading the settings a person typed", () => {
  it("takes what parses and keeps the default for what does not", () => {
    const parsed = parseWorkHours({
      days: "0,1,2,3,4,9,x",
      start: "10:30",
      end: "not a time",
      lunchMinutes: "45",
      lunchAt: "13:00",
      bufferMinutes: "",
    });

    assert.deepEqual(parsed.days, [0, 1, 2, 3, 4]);
    assert.equal(parsed.start, "10:30");
    assert.equal(parsed.end, DEFAULT_WORK_HOURS.end);
    assert.equal(parsed.lunchMinutes, 45);
    assert.equal(parsed.lunchAt, "13:00");
    assert.equal(parsed.bufferMinutes, DEFAULT_WORK_HOURS.bufferMinutes);
  });

  it("refuses a day that ends before it starts, rather than planning backwards", () => {
    const parsed = parseWorkHours({ start: "19:00", end: "11:00" });

    assert.equal(parsed.start, DEFAULT_WORK_HOURS.start);
    assert.equal(parsed.end, DEFAULT_WORK_HOURS.end);
    assert.ok(capacityMinutes(parsed) > 0);
  });

  it("falls back to the whole default when given nothing", () => {
    assert.deepEqual(parseWorkHours({}), DEFAULT_WORK_HOURS);
  });

  it("treats a setting that was never saved as unset, not as zero", () => {
    // What the database actually hands over: null for every unchosen setting.
    // `Number(null)` is 0, which reads as "no lunch at all" and quietly gives
    // every plan half an hour it does not have.
    const parsed = parseWorkHours({
      days: null,
      start: null,
      end: null,
      lunchMinutes: null,
      lunchAt: null,
      bufferMinutes: null,
    });

    assert.deepEqual(parsed, DEFAULT_WORK_HOURS);
    assert.equal(parsed.lunchMinutes, 30);
    assert.equal(capacityMinutes(parsed), 450);
  });

  it("still takes a deliberate zero when somebody types one", () => {
    assert.equal(parseWorkHours({ bufferMinutes: "0" }).bufferMinutes, 0);
    assert.equal(parseWorkHours({ lunchMinutes: "0" }).lunchMinutes, 0);
  });
});

describe("which days are worked", () => {
  it("names the weekday of a day key without touching timezones", () => {
    // 1 January 1970 was a Thursday; 1 January 2000 a Saturday.
    assert.equal(weekdayOf("1970-01-01"), 4);
    assert.equal(weekdayOf("2000-01-01"), 6);
  });

  it("knows a working day from a weekend", () => {
    assert.equal(isWorkingDay(hours, "1970-01-01"), true); // Thursday
    assert.equal(isWorkingDay(hours, "1970-01-02"), false); // Friday
    assert.equal(isWorkingDay(hours, "1970-01-03"), false); // Saturday
    assert.equal(isWorkingDay(hours, "1970-01-04"), true); // Sunday
  });

  it("says the next day that is actually worked, not simply tomorrow", () => {
    // Thursday's "tomorrow" is Sunday here.
    assert.equal(nextWorkingDay(hours, "1970-01-01"), "1970-01-04");
    assert.equal(nextWorkingDay(hours, "1970-01-04"), "1970-01-05");
  });
});

describe("how much of a day is left", () => {
  it("gives the whole day before it starts", () => {
    assert.equal(remainingMinutes(hours, "09:00"), 450);
    assert.equal(remainingMinutes(hours, "11:00"), 450);
  });

  it("plans only what is left when the day is already running", () => {
    // 14:00 to 19:00 is five hours, less the half-hour lunch still ahead.
    assert.equal(remainingMinutes(hours, "14:00"), 270);
    // After lunch, nothing more is taken off for it.
    assert.equal(remainingMinutes(hours, "15:00"), 240);
    assert.equal(remainingMinutes(hours, "18:30"), 30);
  });

  it("has nothing left once everyone has gone home", () => {
    assert.equal(remainingMinutes(hours, "19:00"), 0);
    assert.equal(remainingMinutes(hours, "22:00"), 0);
  });
});

describe("when somebody may be chased", () => {
  it("is working time inside the day but not at lunch", () => {
    assert.equal(isWorkingTime(hours, "11:30"), true);
    assert.equal(isWorkingTime(hours, "14:15"), false);
    assert.equal(isWorkingTime(hours, "14:30"), true);
    assert.equal(isWorkingTime(hours, "19:00"), false);
    assert.equal(isWorkingTime(hours, "08:00"), false);
  });

  it("moves a message out of lunch to the moment it ends", () => {
    assert.deepEqual(nextWorkingMoment(hours, "1970-01-01", "14:10"), {
      dayKey: "1970-01-01",
      time: "14:30",
    });
  });

  it("moves an early message to the start of the day, and a late one to the next day", () => {
    assert.deepEqual(nextWorkingMoment(hours, "1970-01-01", "07:00"), {
      dayKey: "1970-01-01",
      time: "11:00",
    });
    assert.deepEqual(nextWorkingMoment(hours, "1970-01-01", "20:00"), {
      dayKey: "1970-01-04",
      time: "11:00",
    });
  });

  it("never lands on a day nobody works", () => {
    assert.deepEqual(nextWorkingMoment(hours, "1970-01-02", "12:00"), {
      dayKey: "1970-01-04",
      time: "11:00",
    });
  });

  it("leaves a message already inside working hours where it is", () => {
    assert.deepEqual(nextWorkingMoment(hours, "1970-01-01", "16:20"), {
      dayKey: "1970-01-01",
      time: "16:20",
    });
  });
});
