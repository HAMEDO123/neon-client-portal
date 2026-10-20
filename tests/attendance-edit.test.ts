import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

// Changing a day of the attendance month from its cell. It decides pay, so who
// may do it and what it does to the device's record are pinned.

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");
const actions = read("src", "lib", "actions", "operations-actions.ts");
const body = (name: string) => {
  const start = actions.indexOf(`export async function ${name}(`);
  return actions.slice(start, actions.indexOf("\n}\n", start));
};

describe("editing a day of the month", () => {
  it("is the manager's alone, and answers in words", () => {
    for (const name of ["editAttendanceDay", "removeAttendanceDay"]) {
      const code = body(name);
      assert.match(code, /: Promise<Answer> \{\n  return answering\(/, name);
      assert.match(code, /await requireAdmin\(\);/, name);
    }
  });

  // The manager corrected it because the device was wrong; the next sync must
  // not put the device's figure back.
  it("makes the day the manager's, so the device leaves it alone", () => {
    const code = body("editAttendanceDay");
    assert.match(code, /create: \{ employeeId, day: date, delayHours, earlyHours, breaks, awayHours, source: MANUAL, note \}/);
    assert.match(code, /update: \{ delayHours, earlyHours, breaks, awayHours, source: MANUAL, note \}/);
    // What the device saw — when they arrived and left — is kept.
    assert.equal(/arrivedAt|departedAt/.test(code), false);
  });

  it("is offered on every day that has happened, and on none still to come", () => {
    const grid = read("src", "components", "admin", "attendance-month.tsx");
    assert.match(grid, /\{day\.isFuture \? \(\s*<Mark/);
    assert.match(grid, /<AttendanceCell/);
  });
});
