import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { awayHoursOf, awayMinutesOf, readBreaks, storedBreaks } from "../src/lib/attendance-breaks";
import { computePayroll } from "../src/lib/payroll";

// Out in the middle of the day and back: what the manager types, and what it costs.

describe("a time out", () => {
  it("is read in pairs, in order, and an empty row is no row", () => {
    const read = readBreaks(["15:00", "", "13:00"], ["16:30", "", "13:20"]);
    assert.deepEqual(read, { ok: true, breaks: [{ out: "13:00", back: "13:20" }, { out: "15:00", back: "16:30" }] });
    assert.deepEqual(readBreaks([], []), { ok: true, breaks: [] });
  });

  it("is refused in words when it cannot be a time out", () => {
    assert.equal(readBreaks(["13:00"], [""]).ok, false, "a clock-out with no clock-in");
    assert.equal(readBreaks(["14:00"], ["13:00"]).ok, false, "back before they left");
    assert.equal(readBreaks(["13:00", "13:30"], ["14:00", "15:00"]).ok, false, "two that overlap");
    assert.equal(readBreaks(["1pm"], ["2pm"]).ok, false);
  });

  // The studio's lateness rule, in the middle of the day: whole hours, up.
  it("costs whole hours, rounded up, over the day's total", () => {
    assert.equal(awayHoursOf([]), 0);
    assert.equal(awayHoursOf([{ out: "13:00", back: "13:20" }]), 1);
    assert.equal(awayHoursOf([{ out: "13:00", back: "14:30" }]), 2);
    // Twenty and twenty is forty minutes: one hour, not two.
    assert.equal(awayMinutesOf([{ out: "12:00", back: "12:20" }, { out: "16:00", back: "16:20" }]), 40);
    assert.equal(awayHoursOf([{ out: "12:00", back: "12:20" }, { out: "16:00", back: "16:20" }]), 1);
  });

  it("is read back from what was stored, and nothing unreadable is guessed at", () => {
    assert.deepEqual(storedBreaks([{ out: "13:00", back: "14:00" }, { out: "x", back: "y" }, "nope"]), [{ out: "13:00", back: "14:00" }]);
    assert.deepEqual(storedBreaks(null), []);
  });
});

describe("what a time out costs in pay", () => {
  it("is the same hourly rate as lateness, beside it", () => {
    // 520 a month is 2.50 an hour.
    const pay = computePayroll({ salaryAmount: 520, payBasis: "MONTHLY", delayHours: 1, earlyHours: 0, awayHours: 2, receiptTotal: 0 });
    assert.equal(pay.awayHours, 2);
    assert.equal(pay.lostHours, 3);
    assert.equal(pay.cutoff, 7.5);
    assert.equal(computePayroll({ salaryAmount: 520, payBasis: "MONTHLY", delayHours: 0, earlyHours: 0, receiptTotal: 0 }).awayHours, 0);
  });

  it("is summed into the month with the rest of the day's hours", () => {
    const queries = readFileSync(join(process.cwd(), "src", "lib", "payroll-queries.ts"), "utf8");
    // Read off the day rows and added up per pay period, since somebody paid
    // by the week has a row per week rather than one for the month.
    assert.match(queries, /awayHours: true,/);
    assert.match(queries, /awayHours: sum\(days, \(day\) => day\.awayHours\)/);
    assert.match(queries, /shortHours: sum\(days, \(day\) => day\.shortHours\)/);
    const action = readFileSync(join(process.cwd(), "src", "lib", "actions", "operations-actions.ts"), "utf8");
    assert.match(action, /readBreaks\(formData\.getAll\("breakOut"\), formData\.getAll\("breakBack"\)\)/);
  });
});
