import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DURATION,
  REMIND_CHOICES,
  defaultWhen,
  endsAt,
  isLive,
  isPast,
  mayRespond,
  mayScheduleMeetings,
  memberKeyOf,
  readMinutes,
  readWhen,
  remindAt,
  rsvpCounts,
  slashMeeting,
  sortMeetingList,
  startsDistance,
  whenLabel,
} from "../src/lib/chat-meetings";
import { peerConversation, type ChatViewer } from "../src/lib/chat-conversations";
import { DEFAULT_WORK_HOURS } from "../src/lib/work-hours";

const zone = "Asia/Amman";
const manager: ChatViewer = { type: "ADMIN", id: null, name: "Manager" };
const wael: ChatViewer = { type: "EMPLOYEE", id: "cmwael00000000000000", name: "Wael" };
const sally: ChatViewer = { type: "EMPLOYEE", id: "cmsally0000000000000", name: "Sally" };
// Newer ICU puts a narrow space before AM/PM.
const plain = (text: string) => text.replace(/\s/g, " ");

// Wednesday 16 September 2026, 11:00 in Amman — the start of a working day.
const wednesday11 = new Date("2026-09-16T08:00:00Z");

describe("typing /meet", () => {
  it("opens the meeting form, with the rest of the line as the title", () => {
    assert.deepEqual(slashMeeting("/meet Villa review"), { title: "Villa review" });
    assert.deepEqual(slashMeeting("/meeting Villa review"), { title: "Villa review" });
    assert.deepEqual(slashMeeting("  /MEET   Site visit  "), { title: "Site visit" });
    assert.deepEqual(slashMeeting("/meet"), { title: "" });
  });

  it("leaves every other message alone", () => {
    assert.equal(slashMeeting("/meetings"), null);
    assert.equal(slashMeeting("/meet-notes"), null);
    assert.equal(slashMeeting("please /meet this"), null);
    assert.equal(slashMeeting("meet me at the site"), null);
  });
});

describe("who sets a meeting and who answers it", () => {
  it("lets only the manager set one, and never in a chat between two employees", () => {
    assert.equal(mayScheduleMeetings(manager, { kind: "team" }), true);
    assert.equal(mayScheduleMeetings(manager, { kind: "direct", employeeId: wael.id }), true);
    assert.equal(mayScheduleMeetings(wael, { kind: "team" }), false);
    assert.equal(mayScheduleMeetings(manager, peerConversation(wael.id, sally.id)), false);
  });

  it("knows the manager by a key, since they have no employee row", () => {
    assert.equal(memberKeyOf(manager), "admin");
    assert.equal(memberKeyOf(wael), wael.id);
  });

  it("lets only the people who were asked answer", () => {
    assert.equal(mayRespond(manager, ["admin", wael.id]), true);
    assert.equal(mayRespond(wael, ["admin", wael.id]), true);
    assert.equal(mayRespond(sally, ["admin", wael.id]), false);
  });
});

describe("the moment a meeting starts", () => {
  it("reads the day and time the form names, in the company's timezone", () => {
    const when = readWhen("2026-09-16", "14:30", zone, wednesday11);
    assert.equal(when.ok, true);
    if (when.ok) {
      assert.equal(when.startsAt.toISOString(), "2026-09-16T11:30:00.000Z");
      assert.equal(when.dayKey, "2026-09-16");
    }
  });

  it("refuses a day that is not one, a time that is not one, and a date that never was", () => {
    assert.equal(readWhen("", "14:30", zone, wednesday11).ok, false);
    assert.equal(readWhen("2026-09-16", "", zone, wednesday11).ok, false);
    assert.equal(readWhen("2026-02-30", "14:30", zone, wednesday11).ok, false);
  });

  it("refuses a time that has passed, with a minute's grace for a form just filled in", () => {
    assert.equal(readWhen("2026-09-16", "10:00", zone, wednesday11).ok, false);
    // 30 seconds ago: the manager pressed save a moment after the minute turned.
    const justNow = new Date(wednesday11.getTime() + 30_000);
    assert.equal(readWhen("2026-09-16", "11:00", zone, justNow).ok, true);
  });
});

describe("how long, and how much warning", () => {
  it("reads a number of minutes off a form, and keeps 0 as a real answer", () => {
    // Number("") and Number(null) are both 0, and 0 means "only at the time".
    assert.equal(readMinutes("", REMIND_CHOICES, 10), 10);
    assert.equal(readMinutes(null, REMIND_CHOICES, 10), 10);
    assert.equal(readMinutes("0", REMIND_CHOICES, 10), 0);
    assert.equal(readMinutes("30", REMIND_CHOICES, 10), 30);
  });

  it("falls back for anything it does not offer", () => {
    assert.equal(readMinutes("7", REMIND_CHOICES, 10), 10);
    assert.equal(readMinutes("abc", REMIND_CHOICES, 10), 10);
    assert.equal(readMinutes("1.5", REMIND_CHOICES, 10), 10);
  });

  it("warns people before it starts, or not at all when nobody asked for a warning", () => {
    const start = new Date("2026-09-16T11:30:00Z");
    assert.equal(remindAt(start, 0), null);
    assert.equal(remindAt(start, 10)?.toISOString(), "2026-09-16T11:20:00.000Z");
  });

  it("knows when it is over", () => {
    const start = new Date("2026-09-16T11:30:00Z");
    assert.equal(endsAt(start, 30).toISOString(), "2026-09-16T12:00:00.000Z");
    assert.equal(isLive(start, 30, new Date("2026-09-16T11:45:00Z").getTime()), true);
    assert.equal(isLive(start, 30, new Date("2026-09-16T12:05:00Z").getTime()), false);
    assert.equal(isPast(start, 30, new Date("2026-09-16T12:05:00Z").getTime()), true);
    assert.equal(isPast(start, 30, new Date("2026-09-16T11:45:00Z").getTime()), false);
  });
});

describe("what the form opens on", () => {
  it("proposes the next half hour while the working day still holds the meeting", () => {
    // 11:11 in Amman, on a working day.
    const at1111 = new Date("2026-09-16T08:11:00Z");
    assert.deepEqual(defaultWhen(DEFAULT_WORK_HOURS, zone, at1111), { dayKey: "2026-09-16", time: "11:30" });
  });

  it("moves to the next working day when today has no room left", () => {
    // 18:50 in Amman: rounding up lands at 19:00, and the day ends at 19:00.
    const late = new Date("2026-09-16T15:50:00Z");
    const when = defaultWhen(DEFAULT_WORK_HOURS, zone, late);
    assert.notEqual(when.dayKey, "2026-09-16");
    assert.equal(when.time, DEFAULT_WORK_HOURS.start);
  });
});

describe("how a card writes the time", () => {
  it("says today, tomorrow and yesterday before it says a date", () => {
    assert.equal(plain(whenLabel(new Date("2026-09-16T11:30:00Z"), wednesday11, zone)), "Today, 2:30 PM");
    assert.equal(plain(whenLabel(new Date("2026-09-17T08:00:00Z"), wednesday11, zone)), "Tomorrow, 11:00 AM");
    assert.equal(plain(whenLabel(new Date("2026-09-15T12:00:00Z"), wednesday11, zone)), "Yesterday, 3:00 PM");
    assert.equal(plain(whenLabel(new Date("2026-09-24T11:30:00Z"), wednesday11, zone)), "Thu 24 Sep, 2:30 PM");
  });

  it("says how far off it is, and that it has started once it has", () => {
    const now = wednesday11.getTime();
    assert.deepEqual(startsDistance(new Date("2026-09-16T08:45:00Z"), now), { text: "in 45 min", started: false });
    assert.deepEqual(startsDistance(new Date("2026-09-16T11:00:00Z"), now), { text: "in 3 h", started: false });
    assert.deepEqual(startsDistance(new Date("2026-09-16T07:50:00Z"), now), { text: "started 10 min ago", started: true });
  });
});

describe("what the answers add up to", () => {
  it("counts silence as silence, never as a refusal", () => {
    const counts = rsvpCounts([{ rsvp: "ACCEPTED" }, { rsvp: "DECLINED" }, { rsvp: "INVITED" }, { rsvp: "INVITED" }]);
    assert.deepEqual(counts, { accepted: 1, declined: 1, pending: 2, total: 4 });
  });

  it("puts what has not happened yet first, soonest on top, then what is over", () => {
    const now = wednesday11.getTime();
    const soon = { id: "soon", startsAt: new Date("2026-09-16T09:00:00Z"), durationMinutes: DEFAULT_DURATION };
    const later = { id: "later", startsAt: new Date("2026-09-16T13:00:00Z"), durationMinutes: DEFAULT_DURATION };
    const over = { id: "over", startsAt: new Date("2026-09-16T06:00:00Z"), durationMinutes: DEFAULT_DURATION };

    assert.deepEqual(
      sortMeetingList([over, later, soon], now).map((one) => one.id),
      ["soon", "later", "over"]
    );
  });
});
