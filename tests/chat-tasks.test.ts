import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  defaultDue,
  dueDistance,
  dueLabel,
  isImageAttachment,
  isOverdue,
  mayComment,
  mayCreateTasks,
  overallState,
  progressOf,
  readAssignees,
  readDue,
  slashTask,
  sortTaskList,
} from "../src/lib/chat-tasks";
import { peerConversation, type ChatViewer } from "../src/lib/chat-conversations";
import { DEFAULT_WORK_HOURS } from "../src/lib/work-hours";

const zone = "Asia/Amman";
const manager: ChatViewer = { type: "ADMIN", id: null, name: "Manager" };
const wael: ChatViewer = { type: "EMPLOYEE", id: "cmwael00000000000000", name: "Wael" };
const sally: ChatViewer = { type: "EMPLOYEE", id: "cmsally0000000000000", name: "Sally" };
// Newer ICU puts a narrow space before AM/PM.
const plain = (text: string) => text.replace(/\s/g, " ");

describe("typing /task", () => {
  it("opens the task form, with the rest of the line as the title", () => {
    assert.deepEqual(slashTask("/task Call the tile supplier"), { title: "Call the tile supplier" });
    assert.deepEqual(slashTask("  /TASK   Measure the kitchen  "), { title: "Measure the kitchen" });
    assert.deepEqual(slashTask("/task"), { title: "" });
  });

  it("leaves every other message alone", () => {
    assert.equal(slashTask("/tasks"), null);
    assert.equal(slashTask("/taskforce meeting"), null);
    assert.equal(slashTask("please /task this"), null);
    assert.equal(slashTask("task: buy grout"), null);
  });
});

describe("who hands out tasks and who writes under them", () => {
  it("lets only the manager hand out tasks, and never in a chat between two employees", () => {
    assert.equal(mayCreateTasks(manager, { kind: "team" }), true);
    assert.equal(mayCreateTasks(manager, { kind: "direct", employeeId: wael.id }), true);
    assert.equal(mayCreateTasks(wael, { kind: "team" }), false);
    assert.equal(mayCreateTasks(wael, { kind: "direct", employeeId: wael.id }), false);
    assert.equal(mayCreateTasks(manager, peerConversation(wael.id, sally.id)), false);
  });

  it("lets the manager and the people on the task comment, and nobody else", () => {
    assert.equal(mayComment(manager, [wael.id]), true);
    assert.equal(mayComment(wael, [wael.id, sally.id]), true);
    assert.equal(mayComment(sally, [wael.id]), false);
  });
});

describe("who a task goes to", () => {
  const members = [wael.id!, sally.id!];

  it("takes everybody asked for, each once", () => {
    assert.deepEqual(readAssignees([wael.id!, sally.id!, wael.id!], members), { ok: true, ids: [wael.id, sally.id] });
  });

  it("refuses nobody, and refuses a list with somebody outside the chat whole", () => {
    assert.equal(readAssignees([], members).ok, false);
    assert.equal(readAssignees(["", "  "], members).ok, false);
    const outsider = readAssignees([wael.id!, "cmstranger000000000"], members);
    assert.deepEqual(outsider, { ok: false, reason: "A task can only go to people in this chat." });
  });
});

describe("when a task is due", () => {
  // 15:00 on Tuesday 15 September in Amman.
  const tuesdayAfternoon = new Date("2026-09-15T12:00:00Z");

  it("reads a day and a time as that moment in the company's timezone", () => {
    const due = readDue("2026-09-16", "15:30", zone, tuesdayAfternoon);
    assert.ok(due.ok);
    assert.equal(due.dueAt.toISOString(), "2026-09-16T12:30:00.000Z");
    assert.equal(due.dayKey, "2026-09-16");
  });

  it("refuses a moment that has passed, a day that is not one, and a time that is not one", () => {
    assert.deepEqual(readDue("2026-09-15", "14:00", zone, tuesdayAfternoon), {
      ok: false,
      reason: "That time has already passed.",
    });
    assert.equal(readDue("2026-02-30", "10:00", zone, tuesdayAfternoon).ok, false);
    assert.equal(readDue("tomorrow", "10:00", zone, tuesdayAfternoon).ok, false);
    assert.equal(readDue("2026-09-16", "25:00", zone, tuesdayAfternoon).ok, false);
    assert.equal(readDue("2026-09-16", "", zone, tuesdayAfternoon).ok, false);
  });

  it("gives a minute's grace to a form filled in a moment ago", () => {
    assert.equal(readDue("2026-09-15", "15:00", zone, new Date("2026-09-15T12:00:30Z")).ok, true);
  });

  it("defaults to the end of today while an hour of it is left, else the end of the next working day", () => {
    assert.deepEqual(defaultDue(DEFAULT_WORK_HOURS, zone, tuesdayAfternoon), { dayKey: "2026-09-15", time: "19:00" });
    // 18:30: half an hour left is not a day to hand work out for.
    assert.deepEqual(defaultDue(DEFAULT_WORK_HOURS, zone, new Date("2026-09-15T15:30:00Z")), {
      dayKey: "2026-09-16",
      time: "19:00",
    });
    // Thursday evening and Friday: the next working day is Sunday.
    assert.deepEqual(defaultDue(DEFAULT_WORK_HOURS, zone, new Date("2026-09-17T17:00:00Z")), {
      dayKey: "2026-09-20",
      time: "19:00",
    });
    assert.deepEqual(defaultDue(DEFAULT_WORK_HOURS, zone, new Date("2026-09-18T07:00:00Z")), {
      dayKey: "2026-09-20",
      time: "19:00",
    });
  });

  it("writes the due moment the way a card does", () => {
    assert.equal(plain(dueLabel("2026-09-15T16:00:00Z", tuesdayAfternoon, zone)), "Today, 7:00 PM");
    assert.equal(plain(dueLabel("2026-09-16T08:00:00Z", tuesdayAfternoon, zone)), "Tomorrow, 11:00 AM");
    assert.equal(plain(dueLabel("2026-09-14T12:00:00Z", tuesdayAfternoon, zone)), "Yesterday, 3:00 PM");
    assert.equal(plain(dueLabel("2026-09-17T16:00:00Z", tuesdayAfternoon, zone)), "Thu 17 Sep, 7:00 PM");
    // 22:30 UTC on the 15th is already 1:30 on the 16th in Amman.
    assert.equal(plain(dueLabel("2026-09-15T22:30:00Z", tuesdayAfternoon, zone)), "Tomorrow, 1:30 AM");
  });

  it("says how far off it is, and how late", () => {
    const now = tuesdayAfternoon.getTime();
    assert.deepEqual(dueDistance("2026-09-15T12:45:00Z", now), { text: "in 45 min", late: false });
    assert.deepEqual(dueDistance("2026-09-15T15:10:00Z", now), { text: "in 3 h", late: false });
    assert.deepEqual(dueDistance("2026-09-18T12:00:00Z", now), { text: "in 3 days", late: false });
    assert.deepEqual(dueDistance("2026-09-15T10:00:00Z", now), { text: "2 h late", late: true });
    assert.deepEqual(dueDistance("2026-09-15T12:00:20Z", now), { text: "now", late: false });
  });
});

describe("a card with several people on it", () => {
  it("counts whose part is approved", () => {
    assert.deepEqual(progressOf([{ state: "DONE" }, { state: "SUBMITTED" }]), { done: 1, total: 2, complete: false });
    assert.deepEqual(progressOf([{ state: "DONE" }, { state: "DONE" }]), { done: 2, total: 2, complete: true });
    assert.deepEqual(progressOf([]), { done: 0, total: 0, complete: false }, "nobody on it is not finished");
  });

  it("reads as a whole: done, then waiting on review, then started, then to do", () => {
    assert.equal(overallState([{ state: "DONE" }, { state: "DONE" }]), "DONE");
    assert.equal(overallState([{ state: "DONE" }, { state: "SUBMITTED" }]), "SUBMITTED");
    assert.equal(overallState([{ state: "TODO" }, { state: "IN_PROGRESS" }]), "IN_PROGRESS");
    assert.equal(overallState([{ state: "TODO" }, { state: "DONE" }]), "IN_PROGRESS", "somebody has finished their part");
    assert.equal(overallState([{ state: "TODO" }, { state: "TOMORROW" }]), "TODO");
    assert.equal(overallState([]), "TODO");
  });

  it("is late past its moment until every part is approved", () => {
    const now = Date.parse("2026-09-15T12:00:00Z");
    assert.equal(isOverdue("2026-09-15T11:00:00Z", [{ state: "SUBMITTED" }], now), true, "waiting on review is still late");
    assert.equal(isOverdue("2026-09-15T11:00:00Z", [{ state: "DONE" }], now), false);
    assert.equal(isOverdue("2026-09-15T13:00:00Z", [{ state: "TODO" }], now), false);
  });
});

describe("what is attached to a card", () => {
  it("shows a photo as a picture, whether uploads recorded its extension or its media type", () => {
    for (const type of ["jpg", "JPEG", "png", "webp", "gif", "avif", "image/png"]) assert.equal(isImageAttachment(type), true, type);
  });

  it("offers everything else as a file to open", () => {
    for (const type of ["pdf", "docx", "zip", "mp4", "application/pdf", "", null, undefined]) {
      assert.equal(isImageAttachment(type), false, String(type));
    }
  });
});

describe("the Tasks list", () => {
  it("puts open work first, soonest due on top, then finished work, most recent first", () => {
    const task = (id: string, dueAt: string, state: "TODO" | "DONE") => ({ id, dueAt, assignments: [{ state }] });
    const sorted = sortTaskList([
      task("done-old", "2026-09-10T10:00:00Z", "DONE"),
      task("open-later", "2026-09-20T10:00:00Z", "TODO"),
      task("done-new", "2026-09-14T10:00:00Z", "DONE"),
      task("open-late", "2026-09-12T10:00:00Z", "TODO"),
    ]);
    assert.deepEqual(
      sorted.map((item) => item.id),
      ["open-late", "open-later", "done-new", "done-old"]
    );
  });
});
