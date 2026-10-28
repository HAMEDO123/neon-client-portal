import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ARRIVAL,
  DEVICE,
  MANUAL,
  attendanceFromPunches,
  departureAfter,
  cutoffFor,
  deviceWallClock,
  earlyHours,
  clockLabel,
  countedHours,
  dayLengthHours,
  endOfDayMinutes,
  groupPunches,
  hoursShort,
  minutesInDay,
  lateHours,
  mayDeviceWrite,
  workedHours,
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
  it("charges whole hours, rounded up", () => {
    // The studio's rule: a part of an hour is an hour. Being late is meant to
    // cost something worth avoiding rather than to be measured exactly.
    assert.equal(lateHours(hours, "11:30"), 1);
    assert.equal(lateHours(hours, "12:00"), 1, "exactly an hour is an hour, not two");
    assert.equal(lateHours(hours, "12:01"), 2);
    assert.equal(lateHours(hours, "11:07"), 1);
  });

  it("is nothing at all when somebody is on time", () => {
    assert.equal(lateHours(hours, "11:00"), 0);
  });

  it("never goes negative for somebody who came early", () => {
    // An hour early is not an hour of credit — payroll multiplies this number.
    assert.equal(lateHours(hours, "10:00"), 0);
    assert.equal(lateHours(hours, "07:15"), 0);
  });

  it("lets the studio's allowance past, and charges the first minute after it", () => {
    // Five minutes here, so 11:05 is the last minute that is not late.
    assert.equal(lateHours(hours, "11:05", 5), 0);
    assert.equal(lateHours(hours, "11:06", 5), 1, "one minute past the allowance still costs an hour");
    assert.equal(lateHours(hours, "12:40", 5), 2);
    assert.equal(lateHours(hours, "14:20", 5), 4);
  });

  it("measures the hours from the end of the allowance, not from the start of the day", () => {
    // 12:05 is 65 minutes after 11:00 but exactly 60 after the allowance, so it
    // is one hour rather than two. Taking the grace off afterwards would round
    // the same arrival up to two and quietly overcharge every late morning.
    assert.equal(lateHours(hours, "12:05", 5), 1);
  });

  it("never charges more than a day, however wrong the reading", () => {
    assert.equal(lateHours(hours, "23:59"), 13);
    assert.equal(lateHours({ ...hours, start: "00:01" }, "23:59"), 24);
  });

  it("refuses a time it cannot read rather than guessing", () => {
    assert.equal(lateHours(hours, "not a time"), 0);
    assert.equal(lateHours(hours, ""), 0);
  });
});

describe("how much of the day leaving early costs", () => {
  // The studio's decision, and the one place it is written down: the five
  // minutes it allows in the morning are not allowed in the evening.
  it("charges whole hours, rounded up, with no allowance at all", () => {
    assert.equal(earlyHours(hours, "19:00"), 0);
    assert.equal(earlyHours(hours, "18:59"), 1, "a minute early is an hour");
    assert.equal(earlyHours(hours, "18:01"), 1);
    assert.equal(earlyHours(hours, "18:00"), 1);
    assert.equal(earlyHours(hours, "17:59"), 2);
    assert.equal(earlyHours(hours, "17:20"), 2);
    assert.equal(earlyHours(hours, "15:00"), 4);
  });

  it("pays nothing for staying late", () => {
    // The trap `lateHours` avoids at its own end of the day: a negative here
    // would be multiplied by the hourly rate and quietly become overtime,
    // which this studio does not have.
    assert.equal(earlyHours(hours, "19:01"), 0);
    assert.equal(earlyHours(hours, "22:30"), 0);
  });

  it("never charges more than a day, whatever the clock says", () => {
    assert.equal(earlyHours(hours, "00:01"), 19);
    assert.equal(earlyHours(hours, "not a time"), 0);
  });
});

describe("a clock-out, and when the device has not given one", () => {
  it("reads the last touch of the day as the departure", () => {
    // In at 11:00, out at 17:30: two hours of the day unworked.
    const [day] = attendanceFromPunches([at(THURSDAY, "08:00"), at(THURSDAY, "14:30")], hours, TZ);

    assert.ok(day.departedAt);
    assert.equal(day.departedLocal, "5:30 PM");
    assert.equal(day.earlyHours, 2);
    assert.equal(day.delayHours, 0);
  });

  it("says nothing about a day with one read, and deducts nothing", () => {
    // Every day in this studio looks like this today. Reading the single read
    // as both arrival and departure would cut a whole day's pay from somebody
    // who worked it.
    const [day] = attendanceFromPunches([at(THURSDAY, "08:00")], hours, TZ);

    assert.equal(day.departedAt, null);
    assert.equal(day.departedLocal, null);
    assert.equal(day.earlyHours, 0);
    assert.equal(day.punches, 1);
  });

  it("treats a second scan moments after the first as one arrival", () => {
    // Somebody scanning again because the machine did not beep. Reading 11:04
    // as a clock-out would charge them eight hours for arriving.
    const [day] = attendanceFromPunches([at(THURSDAY, "08:00"), at(THURSDAY, "08:04")], hours, TZ);

    assert.equal(day.departedAt, null);
    assert.equal(day.earlyHours, 0);
    assert.equal(day.punches, 2, "both reads are still counted");
  });

  it("charges both ends of the day when both went wrong", () => {
    // In at 12:20 — late — and out at 17:00.
    const [day] = attendanceFromPunches([at(THURSDAY, "09:20"), at(THURSDAY, "14:00")], hours, TZ);

    assert.equal(day.delayHours, 2, "11:00 start, 5 minutes' grace");
    assert.equal(day.earlyHours, 2, "19:00 end, no grace");
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
    assert.equal(days[0].delayHours, 1, "11:20 is twenty minutes late, and part of an hour counts as one");
    assert.equal(days[0].arrivedAt.toISOString(), `${THURSDAY}T08:20:00.000Z`);
    assert.equal(days[0].lastAt.toISOString(), `${THURSDAY}T16:00:00.000Z`);
  });

  it("carries the arrival on the studio's clock, never UTC", () => {
    // 15:37Z is 18:37 in Amman. Written as UTC, this line told a manager
    // somebody arrived at 15:37 when the machine had said 18:37 — unambiguous
    // to a machine, and simply wrong to the person reading it.
    const days = attendanceFromPunches([at(THURSDAY, "15:37")], hours, TZ);
    assert.match(days[0].arrivedLocal, /6:37\s?PM/);
    assert.doesNotMatch(days[0].arrivedLocal, /15:37/);
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
        ["2026-09-17", 2],
        ["2026-09-20", 0],
      ]
    );
  });

  it("takes the allowance from the working day, so no caller can forget it", () => {
    // The sync and the check script both call this with three arguments. If the
    // fourth fell back to a constant instead of to these hours, every arrival
    // would be charged from the first minute and nothing on screen would say so.
    const withGrace: WorkHours = { ...hours, graceMinutes: 5 };
    // 08:05Z is 11:05 in Amman — the last minute that is not late.
    assert.equal(attendanceFromPunches([at(THURSDAY, "08:05")], withGrace, TZ)[0].delayHours, 0);
    // 08:06Z is 11:06, one minute past it.
    assert.equal(attendanceFromPunches([at(THURSDAY, "08:06")], withGrace, TZ)[0].delayHours, 1);
    // The same punch against a day with no allowance is late from 11:01.
    assert.equal(attendanceFromPunches([at(THURSDAY, "08:05")], hours, TZ)[0].delayHours, 1);
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

describe("reading the clock a device displayed", () => {
  it("recovers the wall clock whatever timezone this process runs in", () => {
    // Built from local components, exactly as the ZK library builds its answer,
    // so reading them back must give the same numbers on a laptop in Amman and
    // inside a container running UTC. The instant differs between the two; the
    // wall clock is the only part that ever meant anything.
    const asTheDeviceShowedIt = new Date(2026, 8, 17, 11, 30, 45);
    assert.deepEqual(deviceWallClock(asTheDeviceShowedIt), {
      dayKey: "2026-09-17",
      time: "11:30",
      seconds: 45,
    });
  });

  it("keeps the seconds, so a correct clock does not report as slow", () => {
    // Dropping them made a device reading 17:31:41 look 41 seconds behind —
    // a number produced by the reading, not found on the machine.
    assert.equal(deviceWallClock(new Date(2026, 8, 17, 17, 31, 41))?.seconds, 41);
    assert.equal(deviceWallClock(new Date(2026, 8, 17, 17, 31, 0))?.seconds, 0);
  });

  it("pads single digits, so the day is always a key", () => {
    assert.deepEqual(deviceWallClock(new Date(2026, 0, 5, 9, 7, 3)), {
      dayKey: "2026-01-05",
      time: "09:07",
      seconds: 3,
    });
  });

  it("reads a string the same way", () => {
    assert.deepEqual(deviceWallClock("2026-09-17T11:30:00"), {
      dayKey: "2026-09-17",
      time: "11:30",
      seconds: 0,
    });
  });

  it("says nothing rather than guessing at something that is not a time", () => {
    assert.equal(deviceWallClock(null), null);
    assert.equal(deviceWallClock(undefined), null);
    assert.equal(deviceWallClock(""), null);
    assert.equal(deviceWallClock("not a time"), null);
    assert.equal(deviceWallClock(new Date("nonsense")), null);
  });
});

describe("how far back a sync may reach", () => {
  const today = "2026-09-17";

  it("uses the day it was given", () => {
    assert.equal(cutoffFor("2026-09-01", today), "2026-09-01");
  });

  it("falls back to today when it was given nothing", () => {
    // The device holds years of logs. Absent must never mean all of them, or a
    // settled month gains deductions nobody ever charged.
    assert.equal(cutoffFor(undefined, today), today);
    assert.equal(cutoffFor(null, today), today);
  });

  it("falls back to today for an empty box on a form", () => {
    assert.equal(cutoffFor("", today), today);
    assert.equal(cutoffFor("   ", today), today);
  });

  it("refuses anything that is not a day, rather than reaching further than asked", () => {
    assert.equal(cutoffFor("last tuesday", today), today);
    assert.equal(cutoffFor("2026-9-1", today), today, "a real date badly written is still not a day key");
    assert.equal(cutoffFor("2026-09", today), today);
  });
});

// Somebody came in on time and forgot to clock in: the manager sets the
// arrival, and the device still records when they leave.
describe("a day whose arrival the manager set", () => {
  // 11:00 in Amman, the day's start.
  const arrivedAt = new Date(`${THURSDAY}T08:00:00.000Z`);

  it("is never written over at the start of the day", () => {
    assert.equal(mayDeviceWrite(ARRIVAL), false);
  });

  // They scan when they remember. On 2026-10-19 that was 1:37 PM, and read as
  // a clock-out it charged six hours of leaving early.
  it("takes the first read as the forgotten clock-in, never as leaving", () => {
    const [day] = attendanceFromPunches([at(THURSDAY, "10:37")], hours, TZ);
    assert.deepEqual(departureAfter(arrivedAt, day), { departedAt: null, departedLocal: null, earlyHours: 0 });
  });

  it("takes a later read as the departure, measured from that arrival", () => {
    const [day] = attendanceFromPunches([at(THURSDAY, "10:37"), at(THURSDAY, "16:02")], hours, TZ);
    const left = departureAfter(arrivedAt, day);
    assert.equal(left.departedAt?.toISOString(), `${THURSDAY}T16:02:00.000Z`);
    assert.equal(left.earlyHours, 0, "7:02 PM is after the day's end");
  });

  it("charges leaving early the way any other day does", () => {
    const [day] = attendanceFromPunches([at(THURSDAY, "10:37"), at(THURSDAY, "14:00")], hours, TZ);
    // 5:00 PM on a day ending at 7:00 PM.
    assert.equal(departureAfter(arrivedAt, day).earlyHours, 2);
  });

  it("does not call a read within an hour of the arrival a departure", () => {
    const [day] = attendanceFromPunches([at(THURSDAY, "08:10"), at(THURSDAY, "08:30")], hours, TZ);
    assert.deepEqual(departureAfter(arrivedAt, day), { departedAt: null, departedLocal: null, earlyHours: 0 });
  });
});

describe("a day that is always eight hours", () => {
  // The studio's own: 11:00 to 19:00, five minutes' allowance, Saturday an
  // hour shorter.
  const studio: WorkHours = { ...hours, graceMinutes: 5 };
  const withSaturday: WorkHours = { ...studio, days: [0, 1, 2, 3, 4, 6], endByDay: { 6: "18:00" } };
  const MON = "2026-10-19";
  const SAT = "2026-10-24";

  it("ends when the studio does for somebody who was on time", () => {
    assert.equal(endOfDayMinutes(studio, MON, "11:00"), 19 * 60);
    assert.equal(endOfDayMinutes(studio, MON, "11:05"), 19 * 60, "inside the allowance");
    assert.equal(endOfDayMinutes(studio, MON, "10:30"), 19 * 60, "coming early buys no early finish");
  });

  it("moves the end by the hours charged, never by the minutes", () => {
    // A minute past the allowance is an hour of lateness everywhere else in
    // this file, so it is an hour here: 11:06 works until 8, not until 7:06.
    assert.equal(endOfDayMinutes(studio, MON, "11:06"), 20 * 60);
    assert.equal(endOfDayMinutes(studio, MON, "12:05"), 20 * 60, "an hour late to the minute");
    assert.equal(endOfDayMinutes(studio, MON, "12:06"), 21 * 60, "a minute more is another hour");
    assert.equal(endOfDayMinutes(studio, MON, "14:00"), 22 * 60);
  });

  it("gives back a step-out in whole hours too", () => {
    // Out 11:10 to 14:45 is three hours thirty-five, charged as four — so four
    // is what the end of the day moves by.
    assert.equal(endOfDayMinutes(studio, MON, "11:00", 215), 23 * 60);
    assert.equal(endOfDayMinutes(studio, MON, "11:00", 10), 20 * 60, "ten minutes out costs an hour");
  });

  it("can end after midnight, and says so as minutes rather than a clock face", () => {
    // Salem on 2026-10-22, in at 4:08 PM: five hours and three minutes late,
    // counted as six, so the day runs to one in the morning.
    assert.equal(endOfDayMinutes(studio, MON, "16:08"), 25 * 60);
  });

  it("follows Saturday's earlier end", () => {
    assert.equal(endOfDayMinutes(withSaturday, SAT, "11:00"), 18 * 60);
    assert.equal(endOfDayMinutes(withSaturday, SAT, "12:00"), 19 * 60);
  });

  it("charges only what the day was short, in whole hours", () => {
    const owed = endOfDayMinutes(studio, MON, "14:00"); // until 22:00
    assert.equal(hoursShort(owed, 22 * 60), 0, "worked to the end, nothing owed");
    assert.equal(hoursShort(owed, 22 * 60 + 30), 0, "staying later earns nothing");
    assert.equal(hoursShort(owed, 21 * 60 + 59), 1, "a minute short is an hour");
    assert.equal(hoursShort(owed, 19 * 60), 3);
    assert.equal(hoursShort(owed, null), 0, "no clock-out charges nothing");
  });

  it("reads a clock-out after midnight as later than the day, never earlier", () => {
    assert.equal(minutesInDay("00:08", "16:08"), 24 * 60 + 8);
    assert.equal(minutesInDay("19:00", "11:00"), 19 * 60);
    assert.equal(minutesInDay("not a time", "11:00"), null);
  });
});

describe("the time somebody is told their day ends", () => {
  it("reads as a clock does", () => {
    assert.equal(clockLabel(11 * 60), "11:00 AM");
    assert.equal(clockLabel(12 * 60), "12:00 PM", "noon is twelve, not zero");
    assert.equal(clockLabel(19 * 60), "7:00 PM");
    assert.equal(clockLabel(22 * 60), "10:00 PM");
    assert.equal(clockLabel(0), "12:00 AM", "midnight is twelve too");
  });

  it("carries on into the next morning rather than wrapping back", () => {
    // Owed until three minutes past midnight: saying "12:03 AM" is the only
    // honest answer for somebody who started at four in the afternoon.
    assert.equal(clockLabel(24 * 60 + 3), "12:03 AM");
    assert.equal(clockLabel(25 * 60 + 30), "1:30 AM");
  });
});

describe("a day counted for somebody paid by the hour", () => {
  const studio: WorkHours = { ...hours, start: "11:00", end: "19:00" };

  it("knows how long the studio's day is", () => {
    assert.equal(dayLengthHours(studio), 8);
  });

  it("counts what was worked, up to a day and no further", () => {
    assert.equal(countedHours(7.4, studio), 7.4, "a short day is what it was");
    assert.equal(countedHours(8, studio), 8);
    assert.equal(countedHours(9.09, studio), 8, "there is no overtime in this studio");
    assert.equal(countedHours(14, studio), 8);
  });

  it("never counts less than nothing", () => {
    assert.equal(countedHours(-3, studio), 0);
  });

  it("leaves a short day exactly as it happened", () => {
    // Not rounded to something tidier: 4.16 is what Salem worked on 18 October,
    // and a day somebody was short is theirs to see as it was.
    assert.equal(countedHours(4.16, studio), 4.16);
  });
});

describe("a stretch of days added up", () => {
  const studio: WorkHours = { ...hours, start: "11:00", end: "19:00" };

  /** A day on the clock in Amman, as the instants the device stores. */
  const day = (dayKey: string, inAt: string, outAt: string | null, awayHours = 0) => ({
    arrivedAt: new Date(`${dayKey}T${inAt}:00.000Z`),
    departedAt: outAt ? new Date(`${dayKey}T${outAt}:00.000Z`) : null,
    awayHours,
  });

  it("adds up the hours somebody was here", () => {
    const total = workedHours([day("2026-10-20", "08:00", "16:00"), day("2026-10-21", "08:00", "15:00")], studio);
    assert.equal(total.hours, 15);
    assert.equal(total.onSite, 15);
    assert.equal(total.days, 2);
  });

  it("caps each day on its own, so a long Monday cannot pay for a short Tuesday", () => {
    // Nine hours then seven is sixteen on site and fifteen counted — there is
    // no overtime here, and capping the sum instead would have paid the ninth
    // hour back on Tuesday.
    const total = workedHours([day("2026-10-20", "08:00", "17:00"), day("2026-10-21", "08:00", "15:00")], studio);
    assert.equal(total.onSite, 16);
    assert.equal(total.hours, 15);
  });

  it("takes a step-out off the day", () => {
    const total = workedHours([day("2026-10-20", "08:00", "16:00", 1)], studio);
    assert.equal(total.hours, 7);
  });

  it("counts a day with no clock-out as unknown rather than as nothing", () => {
    const total = workedHours([day("2026-10-20", "08:00", "16:00"), day("2026-10-21", "08:00", null)], studio);
    assert.equal(total.hours, 8, "only the day both ends are known for");
    assert.equal(total.days, 1);
    assert.equal(total.daysWithoutClockOut, 1, "and the other one is said, not buried");
  });

  it("leaves a day the manager typed out of it entirely", () => {
    // A figure typed by hand has no times to measure. Reading it as zero hours
    // worked would say somebody was absent on a day nobody knows the shape of.
    const total = workedHours([{ arrivedAt: null, departedAt: null, awayHours: 2 }], studio);
    assert.deepEqual(total, { hours: 0, onSite: 0, days: 0, daysWithoutClockOut: 0 });
  });

  it("rounds once, at the end", () => {
    // 0.12 + 0.33 in binary floating point is 0.44999999999999996, and a
    // figure like that printed beside somebody's pay is a figure nobody trusts.
    const total = workedHours(
      [day("2026-10-20", "08:00", "08:07"), day("2026-10-21", "08:00", "08:20")],
      studio
    );
    assert.equal(total.hours, 0.45);
  });

  it("says nothing happened for no days at all", () => {
    assert.deepEqual(workedHours([], studio), { hours: 0, onSite: 0, days: 0, daysWithoutClockOut: 0 });
  });
});
