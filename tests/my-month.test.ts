import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { myMonth } from "../src/lib/my-month";
import { periodDayKeys } from "../src/lib/pay-period";
import type { WorkHours } from "../src/lib/work-hours";

// Saturday to Thursday, Friday off — the studio's week.
const HOURS = { days: [0, 1, 2, 3, 4, 6] } as unknown as WorkHours;
const NOV = periodDayKeys("2026-11"); // 5 Nov – 4 Dec

describe("myMonth", () => {
  it("covers the whole period, 5th to 4th", () => {
    const month = myMonth(NOV, "2026-11-19", HOURS, []);
    assert.equal(month.days[0].dayKey, "2026-11-05");
    assert.equal(month.days.at(-1)!.dayKey, "2026-12-04");
    assert.equal(month.days.find((day) => day.isToday)?.dayKey, "2026-11-19");
  });

  it("calls a working day with no record 'nothing recorded', never absent", () => {
    const month = myMonth(NOV, "2026-11-19", HOURS, []);
    const states = new Set(month.days.filter((day) => day.dayKey <= "2026-11-19").map((day) => day.state));
    assert.deepEqual([...states].sort(), ["none", "off"]);
    // Fridays are off; later days have not happened yet.
    assert.equal(month.days.find((day) => day.dayKey === "2026-11-06")?.state, "off");
    assert.equal(month.days.find((day) => day.dayKey === "2026-11-20")?.state, "future");
    assert.equal(month.percentOnTime, null);
  });

  it("counts on-time and late days from the records", () => {
    const month = myMonth(NOV, "2026-11-19", HOURS, [
      { dayKey: "2026-11-05", delayHours: 0 },
      { dayKey: "2026-11-07", delayHours: 0.5 },
      { dayKey: "2026-11-08", delayHours: 0 },
      { dayKey: "2026-11-09", delayHours: 0 },
      // Outside the period, and a day not yet come: neither counts.
      { dayKey: "2026-11-04", delayHours: 0 },
      { dayKey: "2026-11-25", delayHours: 0 },
    ]);
    assert.equal(month.recorded, 4);
    assert.equal(month.onTime, 3);
    assert.equal(month.percentOnTime, 75);
    assert.equal(month.days.find((day) => day.dayKey === "2026-11-07")?.state, "late");
    // 5–19 Nov is 15 days, two of them Fridays.
    assert.equal(month.workingSoFar, 13);
  });
});
