import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  awaitingApproval,
  awaitingReport,
  isUpcoming,
  needsDate,
  needsReport,
  sortForManager,
} from "../src/lib/site-visits";

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
    assert.equal(needsReport("REPORTED"), true);
    assert.equal(needsReport("MISSED"), true);
    // Calling a visit off before it happens says all there is to say.
    assert.equal(needsReport("CANCELLED"), false);
    assert.equal(needsReport("PLANNED"), false);
    // Nobody writes VISITED: it is what the manager's approval turns a
    // reported visit into, and the words were written a step earlier.
    assert.equal(needsReport("VISITED"), false);
  });

  it("holds a finished visit for the manager rather than calling it done", () => {
    // The studio's rule: whoever went says so, and the manager decides — on
    // the client's own answer, which is asked for at that moment.
    const reported = { state: "REPORTED" as const, scheduledAt: hoursFromNow(-2) };

    assert.equal(awaitingApproval(reported), true);
    // And it is not counted as still owing a write-up: it has one.
    assert.equal(awaitingReport(reported, NOW), false);

    for (const state of ["PLANNED", "VISITED", "MISSED", "CANCELLED"] as const) {
      assert.equal(awaitingApproval({ state, scheduledAt: hoursFromNow(-2) }), false, state);
    }
  });

  it("puts the unanswered first, then what is next, then the settled", () => {
    const overdueOld = { id: "a", state: "PLANNED" as const, scheduledAt: hoursFromNow(-72) };
    const overdueRecent = { id: "b", state: "PLANNED" as const, scheduledAt: hoursFromNow(-3) };
    const soon = { id: "c", state: "PLANNED" as const, scheduledAt: hoursFromNow(4) };
    const later = { id: "d", state: "PLANNED" as const, scheduledAt: hoursFromNow(96) };
    const wentYesterday = { id: "e", state: "VISITED" as const, scheduledAt: hoursFromNow(-24) };
    const wentLastWeek = { id: "f", state: "VISITED" as const, scheduledAt: hoursFromNow(-168) };

    const waiting = { id: "w", state: "REPORTED" as const, scheduledAt: hoursFromNow(-5) };

    const order = sortForManager(
      [wentLastWeek, later, overdueRecent, wentYesterday, soon, overdueOld, waiting],
      NOW
    );

    assert.deepEqual(
      order.map((visit) => visit.id),
      // What the manager has to answer leads — a visit waiting on them, then
      // one nobody has written up. Then soonest next, then the record.
      ["w", "a", "b", "c", "d", "e", "f"]
    );
  });

  it("treats a visit with no day as waiting to be scheduled, not as overdue", () => {
    // The manager writes down that a client needs seeing and leaves the when
    // to whoever is going. A missing date is not a date in the past: reading
    // it as one would put a visit nobody has scheduled at the top of the
    // overdue list, every day, for ever.
    const undated = { state: "PLANNED" as const, scheduledAt: null };

    assert.equal(needsDate(undated), true);
    assert.equal(awaitingReport(undated, NOW), false);
    assert.equal(isUpcoming(undated, NOW), false);

    // And once it is answered for, it is not waiting for a day either.
    assert.equal(needsDate({ state: "REPORTED" as const, scheduledAt: null }), false);
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

// ---------------------------------------------------------------------------
// When it is, the job it has among the tasks, and the reminder the day before.

import {
  readVisitWhen,
  reminderDue,
  visitReminderCopy,
  visitReminderKey,
  visitTaskNote,
  visitTaskPlan,
  visitTaskTitle,
} from "../src/lib/site-visits";
import { soundFor } from "../src/lib/notifications/types";

const AMMAN = "Asia/Amman";

describe("reading when a visit is", () => {
  // The website's date box sends a wall clock; the server runs in UTC. Read
  // with `new Date`, 14:30 in the studio was stored as 14:30 UTC — 17:30 —
  // and moved three hours further on every edit.
  it("reads the website's wall clock as a time in the studio", () => {
    const read = readVisitWhen("2026-10-05T14:30", AMMAN);
    assert.equal(read.ok, true);
    assert.equal(read.at?.toISOString(), "2026-10-05T11:30:00.000Z");
  });

  it("takes the phone app's instant exactly as it is", () => {
    assert.equal(readVisitWhen("2026-10-05T11:29:00Z", AMMAN).at?.toISOString(), "2026-10-05T11:29:00.000Z");
    assert.equal(readVisitWhen("2026-10-05T14:29:00+03:00", AMMAN).at?.toISOString(), "2026-10-05T11:29:00.000Z");
  });

  it("lets an empty box mean nobody has picked a day", () => {
    assert.deepEqual(readVisitWhen("  ", AMMAN), { ok: true, at: null });
  });

  it("refuses a date that was typed and cannot be read", () => {
    assert.equal(readVisitWhen("next tuesday", AMMAN).ok, false);
    assert.equal(readVisitWhen("2026-13-45T99:99", AMMAN).ok, false);
  });
});

describe("the job a visit has among the tasks", () => {
  const at = new Date("2026-10-05T11:29:00Z"); // 14:29 in Amman

  it("puts a planned visit on its day as work to do", () => {
    assert.deepEqual(visitTaskPlan({ state: "PLANNED", scheduledAt: at }, AMMAN), { dayKey: "2026-10-05", state: "TODO" });
  });

  it("follows the visit: written up is with the manager, approved is done", () => {
    assert.equal(visitTaskPlan({ state: "REPORTED", scheduledAt: at }, AMMAN)?.state, "SUBMITTED");
    assert.equal(visitTaskPlan({ state: "VISITED", scheduledAt: at }, AMMAN)?.state, "DONE");
  });

  // No day means nowhere on the week to put it; not made or called off means
  // it stopped being work to do. The diary keeps the record of both.
  it("has no job without a day, or once it is not going to happen", () => {
    assert.equal(visitTaskPlan({ state: "PLANNED", scheduledAt: null }, AMMAN), null);
    assert.equal(visitTaskPlan({ state: "MISSED", scheduledAt: at }, AMMAN), null);
    assert.equal(visitTaskPlan({ state: "CANCELLED", scheduledAt: at }, AMMAN), null);
  });

  // Half past midnight in Amman is still the evening before in UTC. Taking the
  // day from the server's clock would put the job on the wrong day.
  it("takes the day from the studio's calendar, not the server's", () => {
    const lateNight = new Date("2026-10-05T21:30:00Z"); // 00:30 on the 6th in Amman
    assert.equal(visitTaskPlan({ state: "PLANNED", scheduledAt: lateNight }, AMMAN)?.dayKey, "2026-10-06");
  });

  it("says what it is, when, where and who for", () => {
    assert.equal(visitTaskTitle("Villa in Dabouq"), "Site visit: Villa in Dabouq");
    const note = visitTaskNote({ scheduledAt: at, location: "Dabouq", clientName: "Abed", purpose: "Measure up" }, AMMAN);
    assert.match(note ?? "", /At 2:29\sPM/);
    assert.match(note ?? "", /Where: Dabouq/);
    assert.match(note ?? "", /Client: Abed/);
    assert.match(note ?? "", /Measure up/);
  });
});

describe("the reminder the day before", () => {
  const visitAt = new Date("2026-10-05T11:29:00Z");
  const hours = (h: number) => visitAt.getTime() + h * 3_600_000;

  it("is owed from a day before until the visit starts", () => {
    assert.equal(reminderDue({ state: "PLANNED", scheduledAt: visitAt }, hours(-25)), false);
    assert.equal(reminderDue({ state: "PLANNED", scheduledAt: visitAt }, hours(-24)), true);
    assert.equal(reminderDue({ state: "PLANNED", scheduledAt: visitAt }, hours(-3)), true);
    assert.equal(reminderDue({ state: "PLANNED", scheduledAt: visitAt }, hours(0)), false);
    assert.equal(reminderDue({ state: "PLANNED", scheduledAt: visitAt }, hours(2)), false);
  });

  it("is only ever for a planned visit with a day", () => {
    for (const state of ["REPORTED", "VISITED", "MISSED", "CANCELLED"] as const) {
      assert.equal(reminderDue({ state, scheduledAt: visitAt }, hours(-3)), false, state);
    }
    assert.equal(reminderDue({ state: "PLANNED", scheduledAt: null }, hours(-3)), false);
  });

  // The key is what makes it said once — and a visit that moves is a different
  // appointment, so it earns a reminder of its own.
  it("is keyed to the visit's own time", () => {
    const moved = new Date("2026-10-07T08:00:00Z");
    assert.equal(visitReminderKey("v1", visitAt), "SITE_VISIT_REMINDER:v1:2026-10-05T11:29:00.000Z");
    assert.notEqual(visitReminderKey("v1", visitAt), visitReminderKey("v1", moved));
  });

  it("says tomorrow when it is tomorrow, and today when it is today", () => {
    const visit = { title: "Villa in Dabouq", location: "Dabouq", scheduledAt: visitAt };
    const dayBefore = visitReminderCopy(visit, AMMAN, new Date(hours(-24)));
    assert.equal(dayBefore.title, "Site visit tomorrow");
    assert.match(dayBefore.message, /Villa in Dabouq/);
    assert.match(dayBefore.message, /2:29\sPM/);
    assert.match(dayBefore.message, /Dabouq$/);

    assert.equal(visitReminderCopy(visit, AMMAN, new Date(hours(-2))).title, "Site visit today");
  });

  it("has a sound of its own, and nothing else does", () => {
    assert.equal(soundFor("SITE_VISIT"), "neon-visit.caf");
    assert.equal(soundFor("TASK_ASSIGNED"), null);
    assert.equal(soundFor("CHAT_MESSAGE"), null);
  });
});

// The name the server sends is a file in the phone app's bundle. Renaming one
// without the other is silent: an iPhone that cannot find the file plays its
// ordinary sound, and nothing anywhere says the special one has gone.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SITE_VISIT_SOUND } from "../src/lib/notifications/types";

describe("the site visit sound on the phone", () => {
  it("is a file the app ships", () => {
    assert.equal(existsSync(join(process.cwd(), "ios", "Resources", "Sounds", SITE_VISIT_SOUND)), true);
  });
});
