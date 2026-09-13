import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  countFor,
  describeFiring,
  evaluate,
  mayMoveWork,
  ruleKey,
  type Rule,
  type RuleState,
} from "../src/lib/automation";
import type { PersonDay } from "../src/lib/day-board";

// What these tests are for: a rule engine's failure mode is not being wrong, it
// is being loud. Grace, cooldown and the kill switch are the three things that
// stop an automation from becoming noise nobody reads — and the fourth is that
// it can only ever speak, never touch the work.

const NOW = new Date("2026-09-13T15:00:00.000Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60000);

function day(overrides: Partial<PersonDay> = {}): PersonDay {
  return {
    employeeId: "e1",
    name: "Wael",
    planned: true,
    plannedMinutes: 300,
    capacityMinutes: 450,
    unanswered: 0,
    started: 0,
    blocks: 4,
    needsManager: [],
    contradictions: [],
    blocked: [],
    ...overrides,
  };
}

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "r1",
    name: "Chase a blocker",
    trigger: "blocked",
    atLeast: 1,
    action: "tell",
    recipient: "the-manager",
    graceMinutes: 0,
    cooldownMinutes: 0,
    escalateAfterMinutes: null,
    enabled: true,
    ...overrides,
  };
}

const fresh: RuleState = { since: null, lastActedAt: null };
const blockedDay = day({ blocked: [{ taskName: "2D plan", reason: "Measurements missing", who: "Ali" }] });

describe("what a rule may do at all", () => {
  it("can never move work, whatever anybody configures", () => {
    assert.equal(mayMoveWork(), false);
  });

  it("reads its conditions off the manager's day rather than working them out again", () => {
    assert.equal(countFor("blocked", blockedDay), 1);
    assert.equal(countFor("no-plan", day({ planned: false })), 1);
    assert.equal(countFor("no-plan", day()), 0);
    // The same definition of "too much" the day board draws.
    assert.equal(countFor("overloaded", day({ plannedMinutes: 500, capacityMinutes: 450 })), 1);
    assert.equal(countFor("overloaded", day({ plannedMinutes: 450, capacityMinutes: 450 })), 0);
    assert.equal(countFor("unanswered", day({ unanswered: 3 })), 3);
  });
});

describe("staying quiet", () => {
  it("says nothing when the studio's switch is off, even for a rule just turned on", () => {
    const firing = evaluate(rule(), blockedDay, { since: minutesAgo(120), lastActedAt: null }, NOW, false);

    assert.equal(firing.fires, false);
    assert.match(firing.fires === false ? firing.why : "", /switched off for the studio/i);
  });

  it("says nothing for a rule of its own that is off", () => {
    const firing = evaluate(rule({ enabled: false }), blockedDay, fresh, NOW);

    assert.equal(firing.fires, false);
    assert.match(firing.fires === false ? firing.why : "", /turned off/i);
  });

  it("says nothing when the condition is not true, and says so plainly", () => {
    const firing = evaluate(rule(), day(), fresh, NOW);

    assert.equal(firing.fires, false);
    assert.equal(firing.count, 0);
    assert.match(firing.fires === false ? firing.why : "", /not true for them/i);
  });

  it("waits for the number the rule asks for", () => {
    const firing = evaluate(rule({ atLeast: 2 }), blockedDay, fresh, NOW);

    assert.equal(firing.fires, false);
    assert.match(firing.fires === false ? firing.why : "", /True 1 times; this rule waits for 2/);
  });
});

describe("grace, so nothing is chased the moment it becomes true", () => {
  const patient = rule({ graceMinutes: 30 });

  it("does not fire on the first sighting", () => {
    const firing = evaluate(patient, blockedDay, fresh, NOW);

    assert.equal(firing.fires, false);
    assert.match(firing.fires === false ? firing.why : "", /True for 0 minutes; this rule waits 30/);
  });

  it("does not fire while the grace is still running", () => {
    assert.equal(evaluate(patient, blockedDay, { since: minutesAgo(29), lastActedAt: null }, NOW).fires, false);
  });

  it("fires once it has held long enough", () => {
    const firing = evaluate(patient, blockedDay, { since: minutesAgo(30), lastActedAt: null }, NOW);

    assert.equal(firing.fires, true);
    if (firing.fires) {
      assert.equal(firing.action, "tell");
      assert.equal(firing.recipient, "the-manager");
      assert.equal(firing.heldMinutes, 30);
    }
  });
});

describe("cooldown, so it is not said twice", () => {
  const hourly = rule({ cooldownMinutes: 60 });
  const held: RuleState = { since: minutesAgo(180), lastActedAt: minutesAgo(20) };

  it("stays quiet while the cooldown is running", () => {
    const firing = evaluate(hourly, blockedDay, held, NOW);

    assert.equal(firing.fires, false);
    assert.match(firing.fires === false ? firing.why : "", /Said 20 minutes ago; this rule stays quiet for 60/);
  });

  it("speaks again once it has passed", () => {
    assert.equal(evaluate(hourly, blockedDay, { ...held, lastActedAt: minutesAgo(61) }, NOW).fires, true);
  });
});

describe("escalating, when it has gone on too long", () => {
  const escalating = rule({ action: "ask", recipient: "the-person", escalateAfterMinutes: 120 });

  it("goes to the person while it is still fresh", () => {
    const firing = evaluate(escalating, blockedDay, { since: minutesAgo(60), lastActedAt: null }, NOW);

    assert.equal(firing.fires, true);
    if (firing.fires) {
      assert.equal(firing.recipient, "the-person");
      assert.equal(firing.action, "ask");
      assert.equal(firing.escalated, false);
    }
  });

  it("redirects to the manager once it has, rather than sending a second copy", () => {
    const firing = evaluate(escalating, blockedDay, { since: minutesAgo(180), lastActedAt: null }, NOW);

    assert.equal(firing.fires, true);
    if (firing.fires) {
      assert.equal(firing.recipient, "the-manager");
      assert.equal(firing.action, "escalate");
      assert.equal(firing.escalated, true);
    }
  });

  it("never escalates a rule that was not asked to", () => {
    const firing = evaluate(rule({ escalateAfterMinutes: null }), blockedDay, { since: minutesAgo(600), lastActedAt: null }, NOW);

    assert.equal(firing.fires, true);
    if (firing.fires) assert.equal(firing.escalated, false);
  });
});

describe("saying it once", () => {
  it("keys on the rule, the person and the day, never on the clock", () => {
    const key = ruleKey(rule(), "e1", "2026-09-13", false);

    assert.equal(key, "RULE:r1:e1:2026-09-13");
    // Same inputs an hour later, same key: two overlapping runs say it once.
    assert.equal(ruleKey(rule(), "e1", "2026-09-13", false), key);
  });

  it("gives an escalation its own key, because it is a different thing to say", () => {
    assert.notEqual(ruleKey(rule(), "e1", "2026-09-13", true), ruleKey(rule(), "e1", "2026-09-13", false));
  });
});

describe("what the preview shows before anybody switches it on", () => {
  it("says what would happen", () => {
    const firing = evaluate(rule(), blockedDay, { since: minutesAgo(5), lastActedAt: null }, NOW);

    assert.equal(describeFiring(rule(), firing), "Chase a blocker: tells the manager — true now");
  });

  it("says why it would stay quiet, which is the part worth reading", () => {
    const quiet = evaluate(rule({ graceMinutes: 30 }), blockedDay, fresh, NOW);

    assert.match(describeFiring(rule(), quiet), /quiet — True for 0 minutes/);
  });
});
