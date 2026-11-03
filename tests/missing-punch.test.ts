import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chargedHours, dayCharge, MISSING_PUNCH_HOURS } from "../src/lib/attendance";
import { DEFAULT_WORK_HOURS, type WorkHours } from "../src/lib/work-hours";

// What a forgotten scan costs (lib/attendance.ts, MISSING_PUNCH_HOURS).
//
// The studio's rule, given on 2026-11-03: "اللي بنسى يبصم هو داخل وبنسى ويبصم
// وهو طالع خصم ساعه على الداخل وساعه على الطالع" — an hour for a missing
// clock-in, an hour for a missing clock-out.
//
// Before it, a day nobody clocked out of cost nothing at all, and nineteen
// days were sitting at zero hours on that reasoning. **`dayCharge` had no
// tests of its own** — which is why changing the rule broke nothing and
// therefore proved nothing. These are them.
//
// The two things that must not creep back in:
//
//   - the hour is a **price**, not a measurement, so it never stacks with the
//     shortfall against the end of the day. Charging both would price the same
//     unknown twice, the second time as a guess at when somebody left;
//   - a day the manager wrote by hand is not a day with a missing scan. Their
//     figure is the whole record of it, and adding an hour to it would charge
//     for a scan nobody ever said was missing.

const TZ = "Asia/Amman"; // UTC+3 all year, so 11:00 there is 08:00 Z.
const hours: WorkHours = DEFAULT_WORK_HOURS; // 11:00–19:00, 5 minutes' grace.
const THURSDAY = "2026-10-08";

const at = (dayKey: string, utcTime: string) => new Date(`${dayKey}T${utcTime}:00.000Z`);

const charge = (over: {
  arrivedAt?: Date | null;
  departedAt?: Date | null;
  awayMinutes?: number;
  typed?: { delayHours: number; earlyHours: number; awayHours: number };
}) =>
  dayCharge({
    hours,
    timeZone: TZ,
    dayKey: THURSDAY,
    arrivedAt: over.arrivedAt ?? null,
    departedAt: over.departedAt ?? null,
    awayMinutes: over.awayMinutes,
    typed: over.typed,
  });

describe("a forgotten scan costs an hour", () => {
  it("charges the hour when somebody arrived and never clocked out", () => {
    // In at 11:00 on the dot, so there is no lateness and no shortfall to
    // confuse the figure with: the hour is the whole of it.
    const { shortHours } = charge({ arrivedAt: at(THURSDAY, "08:00") });

    assert.equal(shortHours, MISSING_PUNCH_HOURS);
    assert.equal(shortHours, 1);
  });

  it("charges the hour when somebody clocked out and never clocked in", () => {
    const { shortHours } = charge({ departedAt: at(THURSDAY, "16:00") });

    assert.equal(shortHours, MISSING_PUNCH_HOURS);
  });

  it("does not stack the hour with the shortfall against the end of the day", () => {
    // The day owed until 7 PM. Without a clock-out there is nothing to measure
    // against that end, so the day is the flat hour — not the hour *plus* a
    // guess at how much of the day went unworked.
    const { shortHours } = charge({ arrivedAt: at(THURSDAY, "08:00") });
    assert.equal(shortHours, 1, "an hour, not nine");
  });

  it("is not charged on a day with both scans, however the day went", () => {
    // Worked to the end: nothing off.
    assert.equal(charge({ arrivedAt: at(THURSDAY, "08:00"), departedAt: at(THURSDAY, "16:00") }).shortHours, 0);

    // Left two hours early: the shortfall, and not a penny of forgotten-scan
    // money on top of it.
    assert.equal(charge({ arrivedAt: at(THURSDAY, "08:00"), departedAt: at(THURSDAY, "14:00") }).shortHours, 2);
  });

  it("still pushes the end back for lateness, then charges the hour and no more", () => {
    // An hour late, so the day owed until 8 PM rather than 7. No clock-out, so
    // that end is never measured against — the charge is the hour either way,
    // and lateness is a fact on the row rather than a second deduction.
    const late = charge({ arrivedAt: at(THURSDAY, "09:00") });

    assert.equal(late.shortHours, 1);
    assert.equal(late.endsAtMinutes, 20 * 60, "the end owed is still worked out and reported");
  });

  it("leaves a day the manager typed exactly as they typed it", () => {
    // No times at all: their figure is the whole record of the day, and there
    // is no scan anybody said was missing.
    const typed = charge({ typed: { delayHours: 2, earlyHours: 0, awayHours: 0.5 } });

    assert.equal(typed.shortHours, 2.5, "no hour added to a hand-written day");
    assert.equal(typed.endsAtMinutes, null);
  });

  it("charges nothing for a day with no times and nothing typed", () => {
    // An empty row is "nothing was recorded", which is not a forgotten scan —
    // the platform cannot tell it from a day somebody did not come, and
    // charging it would dock people for the device being off.
    assert.equal(charge({}).shortHours, 0);
  });

  it("is the figure payroll multiplies, through chargedHours too", () => {
    // `chargedHours` is what the store and the editor call. If the two ever
    // disagreed, the screen and the payslip would show different money.
    const input = {
      hours,
      timeZone: TZ,
      dayKey: THURSDAY,
      arrivedAt: at(THURSDAY, "08:00"),
      departedAt: null,
    };

    assert.equal(chargedHours(input), dayCharge(input).shortHours);
    assert.equal(chargedHours(input), 1);
  });
});
