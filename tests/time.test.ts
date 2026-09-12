import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { dayKeyToDate, dateToDayKey, instantAt, shiftDayKey } from "../src/lib/time";

// A deadline is written as a wall-clock time on a day — "09:30 tomorrow" — and
// stored as an instant. Getting the conversion wrong moves every deadline by
// hours without anything looking broken, so it is pinned down here.

describe("a wall-clock time on a day, as an instant", () => {
  it("reads the time in the company's timezone, not the server's", () => {
    // Amman is UTC+3 all year: 09:00 there is 06:00 UTC.
    assert.equal(instantAt("2026-09-13", "09:00", "Asia/Amman")?.toISOString(), "2026-09-13T06:00:00.000Z");
    assert.equal(instantAt("2026-09-13", "17:30", "Asia/Amman")?.toISOString(), "2026-09-13T14:30:00.000Z");
  });

  it("follows a zone through its daylight saving change", () => {
    // The same 09:00 is an hour earlier in London's summer than in its winter.
    assert.equal(instantAt("2026-09-13", "09:00", "Europe/London")?.toISOString(), "2026-09-13T08:00:00.000Z");
    assert.equal(instantAt("2026-01-13", "09:00", "Europe/London")?.toISOString(), "2026-01-13T09:00:00.000Z");
  });

  it("handles both ends of the clock", () => {
    assert.equal(instantAt("2026-09-13", "00:00", "Asia/Amman")?.toISOString(), "2026-09-12T21:00:00.000Z");
    assert.equal(instantAt("2026-09-13", "23:59", "Asia/Amman")?.toISOString(), "2026-09-13T20:59:00.000Z");
  });

  it("says nothing rather than guessing at something that is not a time", () => {
    assert.equal(instantAt("2026-09-13", "", "Asia/Amman"), null);
    assert.equal(instantAt("", "09:00", "Asia/Amman"), null);
    assert.equal(instantAt("2026-09-13", "25:00", "Asia/Amman"), null);
    assert.equal(instantAt("2026-09-13", "09:70", "Asia/Amman"), null);
    assert.equal(instantAt("2026-09-13", "morning", "Asia/Amman"), null);
  });
});

describe("calendar days", () => {
  it("stores a day as the UTC midnight the database keeps", () => {
    assert.equal(dayKeyToDate("2026-09-13").toISOString(), "2026-09-13T00:00:00.000Z");
    assert.equal(dateToDayKey(dayKeyToDate("2026-09-13")), "2026-09-13");
    assert.equal(dateToDayKey(null), null);
  });

  it("shifts days across a month and a year without touching timezones", () => {
    assert.equal(shiftDayKey("2026-09-30", 1), "2026-10-01");
    assert.equal(shiftDayKey("2026-12-31", 1), "2027-01-01");
    assert.equal(shiftDayKey("2026-01-01", -1), "2025-12-31");
  });
});
