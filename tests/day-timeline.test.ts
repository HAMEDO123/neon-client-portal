import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTimeline, collapseQuickStarts, kindOfChange, readReportLine } from "../src/lib/day-timeline";

// The team's home screen as a timeline of the day — the new UI, 2026-11-18.

describe("the day as it went", () => {
  it("reads a report line back into its time, and leaves an unstamped one out", () => {
    assert.deepEqual(readReportLine("11:20 — زيارة موقع سوما"), { minutes: 680, text: "زيارة موقع سوما" });
    assert.deepEqual(readReportLine("9:05 - called the client"), { minutes: 545, text: "called the client" });
    assert.equal(readReportLine("just some words"), null);
    assert.equal(readReportLine("25:00 — nonsense"), null);
  });

  it("says what a move of work means", () => {
    assert.equal(kindOfChange("TODO", "IN_PROGRESS"), "started");
    assert.equal(kindOfChange("SUBMITTED", "IN_PROGRESS"), "sent-back");
    assert.equal(kindOfChange("IN_PROGRESS", "SUBMITTED"), "sent");
    assert.equal(kindOfChange("SUBMITTED", "DONE"), "approved");
    assert.equal(kindOfChange("IN_PROGRESS", "TODO"), null);
  });

  it("makes a start sent a minute later one line, and keeps a start still going", () => {
    const out = collapseQuickStarts([
      { minutes: 600, fromState: "TODO", toState: "IN_PROGRESS", title: "Cash system", href: "/a" },
      { minutes: 601, fromState: "IN_PROGRESS", toState: "SUBMITTED", title: "Cash system", href: "/a" },
      { minutes: 610, fromState: "TODO", toState: "IN_PROGRESS", title: "Drawings", href: "/b" },
    ]);
    assert.deepEqual(
      out.map((change) => `${change.title}:${change.toState}`),
      ["Cash system:SUBMITTED", "Drawings:IN_PROGRESS"]
    );
  });

  it("is in time order, with now and the end owed, and what is to come marked", () => {
    const items = buildTimeline({
      arrivedMinutes: 653,
      endsAtMinutes: 1140,
      nowMinutes: 880,
      reportLines: ["11:20 — site visit", "no time here"],
      changes: [{ minutes: 700, fromState: "TODO", toState: "IN_PROGRESS", title: "Cash system" }],
    });
    assert.deepEqual(
      items.map((item) => `${item.minutes}:${item.kind}:${item.future}`),
      ["653:clock-in:false", "680:report:false", "700:started:false", "880:now:false", "1140:ends:true"]
    );
  });

  it("has no now and no end on a day nobody clocked in", () => {
    const items = buildTimeline({
      arrivedMinutes: null,
      endsAtMinutes: null,
      nowMinutes: 800,
      reportLines: [],
      changes: [],
    });
    assert.deepEqual(items, []);
  });
});
