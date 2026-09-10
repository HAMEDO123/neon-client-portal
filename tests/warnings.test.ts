import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { WARNING_LIMIT, warningCopy, warningKey, warningStanding } from "../src/lib/warnings";
import { DEFAULT_PREFERENCES, isPushEnabled, isTypeEnabled } from "../src/lib/notifications/types";

describe("three warnings and the account closes", () => {
  it("allows three", () => {
    assert.equal(WARNING_LIMIT, 3);
  });

  it("counts down to the one that closes the account", () => {
    assert.deepEqual(warningStanding(0), { count: 0, left: 3, nextIsFinal: false, reached: false });
    assert.deepEqual(warningStanding(1), { count: 1, left: 2, nextIsFinal: false, reached: false });
    assert.deepEqual(warningStanding(2), { count: 2, left: 1, nextIsFinal: true, reached: false });
    assert.deepEqual(warningStanding(3), { count: 3, left: 0, nextIsFinal: false, reached: true });
  });

  it("never counts below nothing", () => {
    assert.equal(warningStanding(-2).count, 0);
  });
});

describe("what the employee's phone says", () => {
  it("names the warning and gives the reason", () => {
    const copy = warningCopy(1, "  Late to the site visit ");
    assert.equal(copy.title, "You got a warning (1 of 3)");
    assert.equal(copy.message, "Late to the site visit");
  });

  it("says so when the next one will close the account", () => {
    assert.match(warningCopy(2, "Missed the deadline").message, /One more warning closes your account\.$/);
    assert.doesNotMatch(warningCopy(1, "Missed the deadline").message, /closes your account/);
  });

  it("says the account is closed on the last one", () => {
    const copy = warningCopy(3, "Third time");
    assert.match(copy.title, /3 of 3.*closed/);
    assert.equal(copy.message, "Third time");
  });

  it("sends each warning once, however often it is retried", () => {
    assert.equal(warningKey("w1"), warningKey("w1"));
    assert.notEqual(warningKey("w1"), warningKey("w2"));
  });
});

describe("a warning always gets through", () => {
  it("cannot be switched off in the employee's preferences", () => {
    const everythingOff = {
      ...DEFAULT_PREFERENCES,
      chatMessages: false,
      taskAssigned: false,
      taskUpdated: false,
      todaySchedule: false,
      tomorrowSchedule: false,
      deadlineReminders: false,
    };
    assert.equal(isTypeEnabled("WARNING", everythingOff), true);
    assert.equal(isPushEnabled("WARNING", everythingOff), true);
  });
});
