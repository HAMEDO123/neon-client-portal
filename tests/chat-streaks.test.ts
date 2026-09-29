import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { chatStreak, sharedDays, streakDay, streakFromMessages } from "../src/lib/chat-streaks";

const days = (...keys: string[]) => new Set(keys);

describe("a streak's arithmetic", () => {
  it("counts today once both have written today", () => {
    assert.deepEqual(chatStreak(days("2026-09-27", "2026-09-28", "2026-09-29"), "2026-09-29"), { count: 3, atRisk: false });
  });

  it("keeps a streak alive through yesterday while today is not complete, and says it is at risk", () => {
    assert.deepEqual(chatStreak(days("2026-09-27", "2026-09-28"), "2026-09-29"), { count: 2, atRisk: true });
  });

  it("ends when a day was missed", () => {
    assert.equal(chatStreak(days("2026-09-26", "2026-09-27"), "2026-09-29"), null);
    // A gap in the middle cuts the count at the gap.
    assert.deepEqual(chatStreak(days("2026-09-25", "2026-09-27", "2026-09-28", "2026-09-29"), "2026-09-29"), {
      count: 3,
      atRisk: false,
    });
  });

  it("has no streak at all rather than a streak of zero", () => {
    assert.equal(chatStreak([], "2026-09-29"), null);
  });

  it("counts a single shared day", () => {
    assert.deepEqual(chatStreak(["2026-09-29"], "2026-09-29"), { count: 1, atRisk: false });
    assert.deepEqual(chatStreak(["2026-09-28"], "2026-09-29"), { count: 1, atRisk: true });
  });

  it("runs across a month and a year turning over", () => {
    assert.deepEqual(chatStreak(days("2025-12-30", "2025-12-31", "2026-01-01"), "2026-01-01"), { count: 3, atRisk: false });
    assert.deepEqual(chatStreak(days("2026-02-28", "2026-03-01"), "2026-03-02"), { count: 2, atRisk: true });
  });

  it("counts only the days both wrote on", () => {
    const both = sharedDays(["2026-09-28", "2026-09-29"], ["2026-09-29"]);
    assert.deepEqual([...both], ["2026-09-29"]);
    assert.deepEqual(chatStreak(both, "2026-09-29"), { count: 1, atRisk: false });
  });
});

describe("a streak's days are the studio's", () => {
  const zone = "Asia/Amman"; // UTC+3

  it("files a message just after midnight in Amman under that Amman day", () => {
    // 21:30 UTC on the 28th is 00:30 on the 29th in Amman.
    assert.equal(streakDay(new Date("2026-09-28T21:30:00Z"), zone), "2026-09-29");
    assert.equal(streakDay(new Date("2026-09-28T20:30:00Z"), zone), "2026-09-28");
  });

  it("counts both people writing either side of UTC midnight as one Amman day", () => {
    const now = new Date("2026-09-29T10:00:00Z");
    const streak = streakFromMessages(
      [
        { side: "admin", at: new Date("2026-09-28T22:00:00Z") }, // 01:00 on the 29th in Amman
        { side: "emp1", at: new Date("2026-09-29T08:00:00Z") },
      ],
      ["admin", "emp1"],
      now,
      zone
    );
    assert.deepEqual(streak, { count: 1, atRisk: false });

    // Read in UTC the same two messages fall on different days, and there is no streak.
    assert.equal(
      streakFromMessages(
        [
          { side: "admin", at: new Date("2026-09-28T22:00:00Z") },
          { side: "emp1", at: new Date("2026-09-29T08:00:00Z") },
        ],
        ["admin", "emp1"],
        now,
        "UTC"
      ),
      null
    );
  });

  it("decides whether today is complete by the studio's today, not the server's", () => {
    // 22:00 UTC on the 29th is already the 30th in Amman: the 29th is yesterday there.
    const now = new Date("2026-09-29T22:00:00Z");
    const messages = [
      { side: "a", at: new Date("2026-09-29T09:00:00Z") },
      { side: "b", at: new Date("2026-09-29T10:00:00Z") },
    ];
    assert.deepEqual(streakFromMessages(messages, ["a", "b"], now, zone), { count: 1, atRisk: true });
    assert.deepEqual(streakFromMessages(messages, ["a", "b"], now, "UTC"), { count: 1, atRisk: false });
  });

  it("ignores anybody who is not one of the two", () => {
    const now = new Date("2026-09-29T10:00:00Z");
    const messages = [
      { side: "a", at: new Date("2026-09-29T09:00:00Z") },
      { side: "someone-else", at: new Date("2026-09-29T09:30:00Z") },
    ];
    assert.equal(streakFromMessages(messages, ["a", "b"], now, zone), null);
  });
});
