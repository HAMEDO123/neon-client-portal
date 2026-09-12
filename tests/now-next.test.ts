import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { describeMinutes, headline, nowAndNext, type PlanSlot } from "../src/lib/now-next";
import { DEFAULT_WORK_HOURS } from "../src/lib/work-hours";

// The working day is 11:00 to 19:00, lunch 14:00–14:30.
const hours = DEFAULT_WORK_HOURS;

function slot(from: string, to: string, what = "Draw the 2D plan", keep = true): PlanSlot {
  return { from, to, what, keep, entryId: "entry-1", jobId: null };
}

const day = [slot("11:00", "12:30", "Site visit"), slot("13:00", "14:00", "BOQ"), slot("15:00", "17:00", "Renders")];

describe("where somebody is in their day", () => {
  it("names the block the clock is inside, and the one after it", () => {
    const state = nowAndNext(day, hours, "11:30");

    assert.equal(state.now?.what, "Site visit");
    assert.equal(state.next?.what, "BOQ");
    assert.equal(state.leftOfBlock, 60);
    assert.equal(state.untilNext, 90);
  });

  it("has no current block between two of them, but still knows what is next", () => {
    const state = nowAndNext(day, hours, "12:45");

    assert.equal(state.now, null);
    assert.equal(state.next?.what, "BOQ");
    assert.equal(state.leftOfBlock, null);
    assert.equal(state.untilNext, 15);
  });

  it("counts the working time left, not the clock time left", () => {
    // 11:00 to 19:00 is 480 minutes, less the half-hour lunch still ahead.
    assert.equal(nowAndNext(day, hours, "11:00").leftOfDay, 450);
    assert.equal(nowAndNext(day, hours, "14:00").leftOfDay, 270);
    assert.equal(nowAndNext(day, hours, "18:30").leftOfDay, 30);
  });

  it("ignores blocks that were never put on the day", () => {
    const state = nowAndNext([slot("11:00", "12:00", "Not on the day", false)], hours, "11:30");

    assert.equal(state.now, null);
    assert.equal(state.next, null);
  });

  it("ignores a block whose times make no sense", () => {
    const state = nowAndNext([slot("13:00", "11:00"), slot("nope", "12:00")], hours, "11:30");

    assert.equal(state.now, null);
    assert.equal(state.next, null);
  });

  it("reads blocks in time order however they were given", () => {
    const jumbled = [slot("15:00", "17:00", "Renders"), slot("11:00", "12:30", "Site visit")];

    assert.equal(nowAndNext(jumbled, hours, "10:00").next?.what, "Site visit");
  });
});

describe("the break, and the edges of the day", () => {
  it("says somebody is on a break without pretending their work stopped existing", () => {
    // A block that runs through lunch is still the block they are on.
    const through = [slot("13:30", "15:00", "Long render")];
    const state = nowAndNext(through, hours, "14:10");

    assert.equal(state.onBreak, true);
    assert.equal(state.now?.what, "Long render");
  });

  it("knows before and after the working day", () => {
    assert.equal(nowAndNext(day, hours, "08:00").beforeWork, true);
    assert.equal(nowAndNext(day, hours, "20:00").afterWork, true);
    assert.equal(nowAndNext(day, hours, "12:00").beforeWork, false);
    assert.equal(nowAndNext(day, hours, "12:00").afterWork, false);
  });

  it("treats a time that is not a time as the start of the day", () => {
    const state = nowAndNext(day, hours, "half past something");

    assert.equal(state.beforeWork, true);
    assert.equal(state.next?.what, "Site visit");
  });
});

describe("the line it leads with", () => {
  it("leads with the work when there is work", () => {
    assert.equal(headline(nowAndNext(day, hours, "11:30"), hours), "Site visit");
  });

  it("says what is next when nothing is running", () => {
    assert.equal(headline(nowAndNext(day, hours, "12:45"), hours), "Next at 13:00");
  });

  it("says the break only when nothing is running through it", () => {
    assert.equal(headline(nowAndNext([], hours, "14:10"), hours), "Break until 14:30");
  });

  it("never implies somebody is idle when the day is simply empty", () => {
    assert.equal(headline(nowAndNext([], hours, "12:00"), hours), "Nothing planned for today");
  });

  it("says plainly when the day has not started or has ended", () => {
    assert.equal(headline(nowAndNext(day, hours, "08:00"), hours), "The day starts at 11:00");
    assert.equal(headline(nowAndNext(day, hours, "20:00"), hours), "That is the day");
  });
});

describe("saying a stretch of time", () => {
  it("reads the way a person would say it", () => {
    assert.equal(describeMinutes(20), "20m");
    assert.equal(describeMinutes(60), "1h");
    assert.equal(describeMinutes(80), "1h 20m");
    assert.equal(describeMinutes(0), "no time left");
    assert.equal(describeMinutes(-5), "no time left");
  });
});
