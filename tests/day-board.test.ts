import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  attentionScore,
  describeDay,
  needingAttention,
  overBy,
  overloaded,
  summarise,
  unplanned,
  type PersonDay,
} from "../src/lib/day-board";

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

describe("a day that does not fit", () => {
  it("is overloaded only when there is more work than the day holds", () => {
    assert.equal(overloaded(day({ plannedMinutes: 450 })), false);
    assert.equal(overloaded(day({ plannedMinutes: 451 })), true);
    assert.equal(overBy(day({ plannedMinutes: 520 })), 70);
    assert.equal(overBy(day({ plannedMinutes: 300 })), 0);
  });

  it("is not overloaded when nobody has said what the day holds", () => {
    assert.equal(overloaded(day({ capacityMinutes: 0, plannedMinutes: 300 })), false);
  });
});

describe("what the manager is shown first", () => {
  it("puts work stuck on somebody else above everything", () => {
    const stuck = day({ blocked: [{ taskName: "Renders", reason: "No measurements", who: "Ali" }] });
    const silent = day({ name: "Sally", unanswered: 5 });

    assert.deepEqual(
      needingAttention([silent, stuck]).map((row) => row.name),
      ["Wael", "Sally"]
    );
  });

  it("counts silence, but least of all", () => {
    const silent = day({ unanswered: 3 });
    const contradicting = day({ contradictions: [{ taskName: "2D plan", said: "started" }] });

    assert.ok(attentionScore(contradicting) > attentionScore(silent));
  });

  it("leaves out a day with nothing to say about it", () => {
    assert.deepEqual(needingAttention([day({ started: 4 })]), []);
    assert.equal(attentionScore(day({ started: 4 })), 0);
  });

  it("orders by name when two days are equally pressing", () => {
    const first = day({ name: "Ahmad", unanswered: 2 });
    const second = day({ name: "Zaid", unanswered: 2 });

    assert.deepEqual(
      needingAttention([second, first]).map((row) => row.name),
      ["Ahmad", "Zaid"]
    );
  });
});

describe("the line under each name", () => {
  it("never says somebody did nothing", () => {
    assert.equal(describeDay(day({ unanswered: 2 })), "2 unanswered");
    assert.match(describeDay(day({ unanswered: 2 })), /unanswered/);
  });

  it("leads with what can be acted on", () => {
    assert.equal(
      describeDay(day({ blocked: [{ taskName: "X", reason: "y", who: null }], unanswered: 3 })),
      "1 blocked"
    );
    assert.equal(
      describeDay(day({ contradictions: [{ taskName: "X", said: "started" }], unanswered: 3 })),
      "Said started, board still pending"
    );
    assert.equal(describeDay(day({ needsManager: [{ answer: "blocked", note: null, taskName: "X" }] })), "1 waiting on you");
  });

  it("says plainly when there is no plan at all", () => {
    assert.equal(describeDay(day({ planned: false })), "No plan on the day yet");
    assert.equal(unplanned(day({ planned: false })), true);
  });

  it("says when everything on the day has been started", () => {
    assert.equal(describeDay(day({ blocks: 3, started: 3 })), "All started");
    assert.equal(describeDay(day({ blocks: 3, started: 1 })), "On the day");
  });

  it("mentions a day that does not fit, once nothing worse is wrong", () => {
    assert.equal(describeDay(day({ plannedMinutes: 600 })), "More planned than the day holds");
  });
});

describe("the numbers across the team", () => {
  it("counts what the manager would want at a glance", () => {
    const summary = summarise([
      day(),
      day({ name: "Sally", planned: false }),
      day({ name: "Salem", plannedMinutes: 600, unanswered: 2 }),
      day({
        name: "Omar",
        blocked: [
          { taskName: "A", reason: "r", who: null },
          { taskName: "B", reason: "r", who: "Ali" },
        ],
        contradictions: [{ taskName: "C", said: "started" }],
      }),
    ]);

    assert.deepEqual(summary, {
      people: 4,
      planned: 3,
      unplanned: 1,
      overloaded: 1,
      blocked: 2,
      unanswered: 2,
      contradictions: 1,
    });
  });

  it("has nothing to say about nobody", () => {
    assert.deepEqual(summarise([]), {
      people: 0,
      planned: 0,
      unplanned: 0,
      overloaded: 0,
      blocked: 0,
      unanswered: 0,
      contradictions: 0,
    });
  });
});
