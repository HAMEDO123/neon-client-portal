import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { awaitingReport, isUpcoming, needsReport, sortForManager } from "../src/lib/site-visits";

// The one judgement worth pinning: a visit whose time has come and gone with
// nothing written against it. Everything the manager opens this screen for
// hangs off it, and it is the only place the platform could be tempted to
// infer that somebody did or did not go.

const NOW = Date.parse("2026-09-27T12:00:00Z");
const hoursFromNow = (h: number) => new Date(NOW + h * 3_600_000);

describe("where a site visit stands", () => {
  it("counts a planned visit whose time has passed as still to be answered", () => {
    assert.equal(awaitingReport({ state: "PLANNED", scheduledAt: hoursFromNow(-2) }, NOW), true);
    assert.equal(awaitingReport({ state: "PLANNED", scheduledAt: hoursFromNow(2) }, NOW), false);
  });

  it("never treats an answered visit as outstanding, whichever way it was answered", () => {
    for (const state of ["VISITED", "MISSED", "CANCELLED"] as const) {
      assert.equal(awaitingReport({ state, scheduledAt: hoursFromNow(-48) }, NOW), false, state);
    }
  });

  it("treats the scheduled moment itself as due, not as still ahead", () => {
    // The boundary either way: at 12:00 exactly the visit is owed an answer,
    // and it is not still coming up. An off-by-one here leaves a visit
    // invisible in both lists.
    const now = { state: "PLANNED" as const, scheduledAt: new Date(NOW) };
    assert.equal(awaitingReport(now, NOW), true);
    assert.equal(isUpcoming(now, NOW), false);
  });

  it("asks for words with an answer that claims something happened", () => {
    assert.equal(needsReport("VISITED"), true);
    assert.equal(needsReport("MISSED"), true);
    // Calling a visit off before it happens says all there is to say.
    assert.equal(needsReport("CANCELLED"), false);
    assert.equal(needsReport("PLANNED"), false);
  });

  it("puts the unanswered first, then what is next, then the settled", () => {
    const overdueOld = { id: "a", state: "PLANNED" as const, scheduledAt: hoursFromNow(-72) };
    const overdueRecent = { id: "b", state: "PLANNED" as const, scheduledAt: hoursFromNow(-3) };
    const soon = { id: "c", state: "PLANNED" as const, scheduledAt: hoursFromNow(4) };
    const later = { id: "d", state: "PLANNED" as const, scheduledAt: hoursFromNow(96) };
    const wentYesterday = { id: "e", state: "VISITED" as const, scheduledAt: hoursFromNow(-24) };
    const wentLastWeek = { id: "f", state: "VISITED" as const, scheduledAt: hoursFromNow(-168) };

    const order = sortForManager([wentLastWeek, later, overdueRecent, wentYesterday, soon, overdueOld], NOW);

    assert.deepEqual(
      order.map((visit) => visit.id),
      // Most overdue first; soonest next; settled newest first.
      ["a", "b", "c", "d", "e", "f"]
    );
  });

  it("does not reorder the caller's array", () => {
    const visits = [
      { id: "x", state: "VISITED" as const, scheduledAt: hoursFromNow(-1) },
      { id: "y", state: "PLANNED" as const, scheduledAt: hoursFromNow(-1) },
    ];
    sortForManager(visits, NOW);
    assert.deepEqual(visits.map((v) => v.id), ["x", "y"]);
  });
});
