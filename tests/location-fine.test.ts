import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  countsForFine,
  dayEndOf,
  dayLabel,
  dayName,
  FINE_ANNOUNCED_KEY,
  FINE_JOD,
  FINE_KEY,
  FINE_KIND,
  fineAmount,
  fineCopy,
  fineKey,
  fineReason,
  fineRule,
  finesByMonth,
  finesDue,
  fineStartsOn,
  fineSwitch,
  forgiveArgs,
  forgivenCopy,
  listOf,
  managerCopy,
  monthAdjustment,
  noticeCopy,
  noticeKey,
  readAnnouncedAt,
  readDayKey,
  readFineOn,
  toldAt,
  WARN_AFTER_START_MINUTES,
  WARN_BEFORE_END_MINUTES,
  warningCopy,
  warningKey,
  warningsDue,
  warningTimes,
  type FineDay,
} from "../src/lib/location-fine";
import { locationWindow } from "../src/lib/staff-location";
import { isTypeEnabled } from "../src/lib/notifications/types";
import { RpcError } from "../src/lib/mobile/rpc";
import { DEFAULT_PREFERENCES } from "../src/lib/notifications/types";
import { DEFAULT_WORK_HOURS } from "../src/lib/work-hours";
import { dayKeyIn } from "../src/lib/time";

// The 1 JOD a working day without location. These functions decide who is
// charged, when they are warned and what their payslip says — money — so the
// rules that keep a flat battery or a server outage from costing anybody a
// dinar are pinned here: an arrival the device saw, one position is enough,
// nothing before the notice, nothing unwarned, nothing after midnight, and the
// month always counted from its days.

const tz = "Asia/Amman"; // UTC+3 all year
const hours = { ...DEFAULT_WORK_HOURS, start: "11:00", end: "19:00" }; // Sunday to Thursday
const SUNDAY = "2026-10-04";
const MONDAY = "2026-10-05";
const THURSDAY = "2026-10-08";
const FRIDAY = "2026-10-09";
const at = (day: string, time: string) => new Date(`${day}T${time}+03:00`);
const window = locationWindow(hours, SUNDAY, tz)!;
const dayEnd = dayEndOf(SUNDAY, tz);
// Told the Thursday before: Sunday counts.
const told = at("2026-10-01", "12:00");

const person = (overrides: Partial<FineDay> = {}): FineDay => ({
  id: "e1",
  arrivedAt: at(SUNDAY, "10:58"),
  departedAt: null,
  fixes: 0,
  warnedAt: null,
  warned2At: null,
  finedAt: null,
  forgivenAt: null,
  announcedAt: told,
  ...overrides,
});
const warned = (overrides: Partial<FineDay> = {}) =>
  person({ warnedAt: at(SUNDAY, "12:00"), warned2At: at(SUNDAY, "18:00"), ...overrides });

const warnings = (now: Date, people: FineDay[]) =>
  warningsDue({ now, window, people }).map((due) => `${due.employeeId}:${due.warning}`);
const fines = (now: Date, people: FineDay[]) => finesDue({ now, window, people, dayEnd });

describe("the switch", () => {
  it("is on until the manager turns it off", () => {
    assert.equal(readFineOn(null), true);
    assert.equal(readFineOn(undefined), true);
    assert.equal(readFineOn(""), true);
    assert.equal(readFineOn("true"), true);
    assert.equal(readFineOn("false"), false);
    assert.equal(readFineOn(" FALSE "), false);
    assert.equal(FINE_KEY, "location_fine");
    assert.equal(FINE_ANNOUNCED_KEY, "location_fine_announced_at");
  });

  it("is turned by true or false and nothing else — a missing argument does not turn it off", () => {
    assert.equal(fineSwitch([true]), true);
    assert.equal(fineSwitch(["true"]), true);
    assert.equal(fineSwitch([false]), false);
    assert.equal(fineSwitch(["false"]), false);
    for (const args of [[], [null], ["off"], [undefined], [{}]]) {
      assert.throws(() => fineSwitch(args), RpcError);
    }
  });

  it("tells the phone what a day costs, and no first day while it is off", () => {
    assert.deepEqual(fineRule(true, SUNDAY), { on: true, amount: 1, startsOn: SUNDAY });
    assert.deepEqual(fineRule(true, null), { on: true, amount: 1, startsOn: null });
    assert.deepEqual(fineRule(false, SUNDAY), { on: false, amount: 1, startsOn: null });
    assert.equal(FINE_JOD, 1);
    assert.equal(FINE_KIND, "LOCATION");
  });
});

describe("the notice", () => {
  it("reads back the stamp it wrote, and nothing that is not a time", () => {
    assert.equal(readAnnouncedAt("2026-10-01T09:00:00.000Z")?.toISOString(), "2026-10-01T09:00:00.000Z");
    assert.equal(readAnnouncedAt(null), null);
    assert.equal(readAnnouncedAt(""), null);
    assert.equal(readAnnouncedAt("soon"), null);
  });

  it("counts a day only if its window started after the person was told — never retroactively", () => {
    assert.equal(countsForFine({ windowStart: window.start, announcedAt: at(SUNDAY, "10:59") }), true);
    assert.equal(countsForFine({ windowStart: window.start, announcedAt: at(SUNDAY, "11:00") }), false);
    assert.equal(countsForFine({ windowStart: window.start, announcedAt: at(SUNDAY, "11:01") }), false);
    assert.equal(countsForFine({ windowStart: window.start, announcedAt: null }), false);
  });

  it("counts somebody as told when their notice was written, and never before the announcement", () => {
    const announced = at(SUNDAY, "09:00");
    assert.equal(toldAt(announced, null), null);
    assert.equal(toldAt(announced, undefined), null);
    // Somebody who joined later is told later, and their days count from then.
    assert.equal(toldAt(announced, at(SUNDAY, "14:00"))?.toISOString(), at(SUNDAY, "14:00").toISOString());
    // A notice row stamped a moment "before" the announcement by another clock is not earlier notice.
    assert.equal(toldAt(announced, at(SUNDAY, "08:59"))?.toISOString(), announced.toISOString());
  });

  it("starts on the day it was announced if that day had not begun, else on the next working day", () => {
    assert.equal(fineStartsOn({ hours, announcedAt: at(SUNDAY, "09:30"), timeZone: tz }), SUNDAY);
    // The day the policy was announced, once its window has opened: not that day.
    assert.equal(fineStartsOn({ hours, announcedAt: at(SUNDAY, "11:00"), timeZone: tz }), MONDAY);
    assert.equal(fineStartsOn({ hours, announcedAt: at(SUNDAY, "20:00"), timeZone: tz }), MONDAY);
    // After Thursday's window, past the weekend.
    assert.equal(fineStartsOn({ hours, announcedAt: at(THURSDAY, "12:00"), timeZone: tz }), "2026-10-11");
    assert.equal(fineStartsOn({ hours, announcedAt: at(FRIDAY, "12:00"), timeZone: tz }), "2026-10-11");
    assert.equal(fineStartsOn({ hours, announcedAt: null, timeZone: tz }), null);
    assert.equal(fineStartsOn({ hours: { ...hours, days: [] }, announcedAt: at(SUNDAY, "09:00"), timeZone: tz }), null);
  });

  it("follows Amman's calendar, not the server's", () => {
    // 21:30 UTC on Saturday is already 00:30 on Sunday in Amman: Sunday's window has not opened.
    const saturdayNightUtc = new Date("2026-10-03T21:30:00Z");
    assert.equal(dayKeyIn(tz, saturdayNightUtc), SUNDAY);
    assert.equal(fineStartsOn({ hours, announcedAt: saturdayNightUtc, timeZone: tz }), SUNDAY);
    // 08:30 UTC is 11:30 in Amman: Sunday's window is open, so Monday.
    assert.equal(fineStartsOn({ hours, announcedAt: new Date("2026-10-04T08:30:00Z"), timeZone: tz }), MONDAY);
  });

  it("says when it starts, what costs 1 JOD and that location is only shared in working hours", () => {
    const copy = noticeCopy(SUNDAY);
    assert.match(copy.message, /^From Sun 4 Oct, 1 JOD is deducted/);
    assert.match(copy.message, /fingerprint sees you arrive/);
    assert.match(copy.message, /no location from your phone reaches NEON during working hours/);
    assert.match(copy.message, /only shared during working hours/);
    assert.match(noticeCopy(null).message, /^1 JOD is deducted/);
  });
});

describe("the day's two warnings", () => {
  it("fall an hour in and an hour before the end, the second never before the first", () => {
    assert.equal(WARN_AFTER_START_MINUTES, 60);
    assert.equal(WARN_BEFORE_END_MINUTES, 60);
    const times = warningTimes(window);
    assert.equal(times.first.toISOString(), at(SUNDAY, "12:00").toISOString());
    assert.equal(times.second.toISOString(), at(SUNDAY, "18:00").toISOString());
    const short = warningTimes({ start: at(SUNDAY, "11:00"), end: at(SUNDAY, "12:30") });
    assert.equal(short.second.toISOString(), short.first.toISOString());
  });

  it("go to somebody the device has seen arrive whose phone has not had a position stored", () => {
    assert.deepEqual(warnings(at(SUNDAY, "11:59"), [person()]), []);
    assert.deepEqual(warnings(at(SUNDAY, "12:00"), [person()]), ["e1:1"]);
    assert.deepEqual(warnings(at(SUNDAY, "15:00"), [person()]), ["e1:1"]);
    assert.deepEqual(warnings(at(SUNDAY, "17:59"), [person({ warnedAt: at(SUNDAY, "12:00") })]), []);
    assert.deepEqual(warnings(at(SUNDAY, "18:00"), [person({ warnedAt: at(SUNDAY, "12:00") })]), ["e1:2"]);
    assert.deepEqual(warnings(at(SUNDAY, "18:30"), [person({ warnedAt: at(SUNDAY, "12:00"), warned2At: at(SUNDAY, "18:00") })]), []);
  });

  it("are not sent once one position has got through", () => {
    assert.deepEqual(warnings(at(SUNDAY, "12:00"), [person({ fixes: 1 })]), []);
    assert.deepEqual(warnings(at(SUNDAY, "18:00"), [person({ fixes: 3, warnedAt: at(SUNDAY, "12:00") })]), []);
  });

  it("are not sent to somebody the device has not seen arrive, nor before they did", () => {
    assert.deepEqual(warnings(at(SUNDAY, "12:00"), [person({ arrivedAt: null })]), []);
    assert.deepEqual(warnings(at(SUNDAY, "12:00"), [person({ arrivedAt: at(SUNDAY, "13:10") })]), []);
    // Arriving late: the first warning still goes, once they are in.
    assert.deepEqual(warnings(at(SUNDAY, "13:15"), [person({ arrivedAt: at(SUNDAY, "13:10") })]), ["e1:1"]);
  });

  it("send only the second to somebody first seen in the last hour — one push, not two at once", () => {
    assert.deepEqual(warnings(at(SUNDAY, "18:20"), [person({ arrivedAt: at(SUNDAY, "18:10") })]), ["e1:2"]);
  });

  it("stop once the device has seen them clock out — the phone stops sharing then", () => {
    assert.deepEqual(warnings(at(SUNDAY, "18:00"), [person({ warnedAt: at(SUNDAY, "12:00"), departedAt: at(SUNDAY, "17:30") })]), []);
    assert.deepEqual(warnings(at(SUNDAY, "18:00"), [person({ warnedAt: at(SUNDAY, "12:00"), departedAt: at(SUNDAY, "18:30") })]), ["e1:2"]);
  });

  it("are only sent while the window is open, and only on a day that counts for that person", () => {
    assert.deepEqual(warnings(at(SUNDAY, "19:00"), [person()]), []);
    assert.deepEqual(warningsDue({ now: at(FRIDAY, "12:00"), window: null, people: [person()] }), []);
    // Told today at 11:30: today cannot be charged, so nothing says it could be.
    assert.deepEqual(warnings(at(SUNDAY, "12:00"), [person({ announcedAt: at(SUNDAY, "11:30") })]), []);
    assert.deepEqual(warnings(at(SUNDAY, "12:00"), [person({ announcedAt: null })]), []);
  });

  it("say what has not reached NEON, and what to do so the day isn't charged", () => {
    const times = { startsAt: "11:00 AM", endsAt: "7:00 PM" };
    const first = warningCopy(1, times);
    assert.equal(first.title, "Your location hasn't reached NEON today");
    assert.match(first.message, /since the day started at 11:00 AM/);
    assert.match(first.message, /Open NEON with location on \(Always\) so today isn't charged 1 JOD\./);
    const second = warningCopy(2, times);
    assert.match(second.message, /^The day ends at 7:00 PM/);
    assert.match(second.message, /so today isn't charged 1 JOD\./);
  });
});

describe("who is charged for the day", () => {
  const evening = at(SUNDAY, "19:00");

  it("is decided from the window's end until midnight in Amman, and at no other time", () => {
    assert.equal(dayEnd.toISOString(), "2026-10-04T21:00:00.000Z");
    assert.deepEqual(fines(at(SUNDAY, "18:59"), [warned()]), []);
    assert.deepEqual(fines(evening, [warned()]), ["e1"]);
    assert.deepEqual(fines(at(SUNDAY, "23:59"), [warned()]), ["e1"]);
    // 21:00 UTC is midnight in Amman: the day has gone, and a day missed is never charged later.
    assert.deepEqual(fines(new Date("2026-10-04T21:00:00Z"), [warned()]), []);
    assert.deepEqual(finesDue({ now: at(FRIDAY, "20:00"), window: null, people: [warned()], dayEnd }), []);
  });

  it("never charges somebody the device did not see arrive — or saw only after the window closed", () => {
    assert.deepEqual(fines(evening, [warned({ arrivedAt: null })]), []);
    assert.deepEqual(fines(evening, [warned({ arrivedAt: at(SUNDAY, "19:00") })]), []);
    assert.deepEqual(fines(evening, [warned({ arrivedAt: at(SUNDAY, "18:59") })]), ["e1"]);
  });

  it("never charges a day on which one position got through", () => {
    assert.deepEqual(fines(evening, [warned({ fixes: 1 })]), []);
  });

  it("never charges a day nobody was warned on — a server that was down could not warn, or keep a position", () => {
    assert.deepEqual(fines(evening, [person()]), []);
    assert.deepEqual(fines(evening, [person({ warnedAt: at(SUNDAY, "12:00") })]), ["e1"]);
    assert.deepEqual(fines(evening, [person({ warned2At: at(SUNDAY, "18:00") })]), ["e1"]);
  });

  it("charges a day once, and never one the manager has cancelled", () => {
    assert.deepEqual(fines(evening, [warned({ finedAt: evening })]), []);
    assert.deepEqual(fines(evening, [warned({ finedAt: evening, forgivenAt: at(SUNDAY, "20:00") })]), []);
  });

  it("does not charge the day the policy was announced, once that day had begun", () => {
    assert.deepEqual(fines(evening, [warned({ announcedAt: at(SUNDAY, "11:00") })]), []);
    assert.deepEqual(fines(evening, [warned({ announcedAt: at(SUNDAY, "09:00") })]), ["e1"]);
    assert.deepEqual(fines(evening, [warned({ announcedAt: null })]), []);
  });

  it("decides each person on their own facts", () => {
    const team = [
      warned({ id: "a" }),
      warned({ id: "b", fixes: 2 }),
      warned({ id: "c", arrivedAt: null }),
      person({ id: "d" }),
      warned({ id: "e", announcedAt: at(SUNDAY, "14:00") }),
      warned({ id: "f" }),
    ];
    assert.deepEqual(fines(evening, team), ["a", "f"]);
  });
});

describe("the month", () => {
  const charged = (day: string, forgiven = false) => ({
    day,
    finedAt: at(day, "19:00"),
    forgivenAt: forgiven ? at(day, "20:00") : null,
  });

  it("costs a dinar for each charged day, and nothing for a cancelled one", () => {
    assert.equal(fineAmount([]), 0);
    assert.equal(fineAmount([charged("2026-10-01"), charged("2026-10-04")]), 2);
    assert.equal(fineAmount([charged("2026-10-01"), charged("2026-10-04", true)]), 1);
    assert.equal(fineAmount([{ finedAt: null, forgivenAt: null }]), 0);
  });

  it("groups days by the payroll month they belong to — two months, two rows", () => {
    const months = finesByMonth([charged("2026-10-01"), charged("2026-09-30"), charged("2026-09-28", true), charged("2026-10-04")]);
    assert.deepEqual([...months.entries()], [
      ["2026-09", ["2026-09-30"]],
      ["2026-10", ["2026-10-01", "2026-10-04"]],
    ]);
    assert.deepEqual(monthAdjustment(months.get("2026-09")!), {
      amount: 1,
      reason: "No location reached NEON from the phone during working hours on 30 Sep — 1 JOD a day.",
    });
    assert.equal(monthAdjustment(months.get("2026-10")!)?.amount, 2);
  });

  it("has no row at all once nothing in it is charged", () => {
    assert.equal(monthAdjustment([]), null);
    assert.equal(finesByMonth([charged("2026-10-01", true)]).size, 0);
  });

  it("names every day in the reason, in order", () => {
    assert.equal(
      fineReason(["2026-10-05", "2026-10-03"]),
      "No location reached NEON from the phone during working hours on 3 Oct, 5 Oct — 1 JOD a day."
    );
  });

  it("writes days the same on every machine", () => {
    assert.equal(dayLabel("2026-09-30"), "30 Sep");
    assert.equal(dayLabel("2026-01-01"), "1 Jan");
    assert.equal(dayName("2026-10-03"), "Sat 3 Oct");
    assert.equal(dayName(SUNDAY), "Sun 4 Oct");
  });
});

describe("the undo", () => {
  it("takes an employee and a real day", () => {
    assert.deepEqual(forgiveArgs(["e1", "2026-10-04"]), { employeeId: "e1", dayKey: "2026-10-04" });
    assert.throws(() => forgiveArgs(["", "2026-10-04"]), RpcError);
    assert.throws(() => forgiveArgs(["e1"]), /YYYY-MM-DD/);
    assert.throws(() => forgiveArgs(["e1", "4 Oct"]), RpcError);
    // Date would roll this into March; it is not a day.
    assert.throws(() => forgiveArgs(["e1", "2026-02-30"]), RpcError);
    assert.equal(readDayKey("2026-02-28"), "2026-02-28");
    assert.equal(readDayKey("2026-13-01"), null);
  });
});

describe("what is said", () => {
  const everything = [
    noticeCopy(SUNDAY),
    warningCopy(1, { startsAt: "11:00 AM", endsAt: "7:00 PM" }),
    warningCopy(2, { startsAt: "11:00 AM", endsAt: "7:00 PM" }),
    fineCopy(SUNDAY),
    forgivenCopy(SUNDAY),
    managerCopy(["Lina"], SUNDAY),
    managerCopy(["Lina", "Omar", "Sami"], SUNDAY),
  ];

  it("says what reached NEON and what did not — never that anybody did anything", () => {
    for (const { title, message } of everything) {
      const text = `${title} ${message}`;
      assert.doesNotMatch(text, /\byou (did not|didn't|failed|refused|forgot|turned|switched|ignored)\b/i, text);
      assert.doesNotMatch(text, /\b(absent|refus|ignor|on purpose|deliberate|disobey|violat|penalt|punish)/i, text);
      assert.doesNotMatch(text, /\b(turned|switched) (it )?off\b/i, text);
    }
    for (const copy of everything.slice(1)) assert.match(`${copy.title} ${copy.message}`, /reached NEON/);
  });

  it("tells the person which day cost 1 JOD and why, and who to tell if that's wrong", () => {
    const copy = fineCopy(SUNDAY);
    assert.equal(copy.title, "1 JOD deducted for Sun 4 Oct");
    assert.match(copy.message, /^1 JOD was deducted for Sun 4 Oct because no location from your phone reached NEON during working hours\./);
    assert.match(copy.message, /If that's wrong, tell the manager\./);
    assert.match(forgivenCopy(SUNDAY).message, /cancelled the 1 JOD deducted for Sun 4 Oct/);
  });

  it("tells the manager once, with every name", () => {
    const one = managerCopy(["Lina"], SUNDAY);
    assert.equal(one.title, "1 JOD deducted from Lina");
    assert.match(one.message, /^Sun 4 Oct: the fingerprint saw Lina arrive, and no location from their phone reached NEON/);
    const three = managerCopy(["Lina", "Omar", "Sami"], SUNDAY);
    assert.equal(three.title, "1 JOD deducted from 3 people");
    assert.match(three.message, /saw Lina, Omar and Sami arrive, and no location from their phones/);
    assert.match(three.message, /1 JOD each was deducted/);
    assert.equal(listOf(["Lina", "Omar"]), "Lina and Omar");
  });

  it("is keyed on what happened, so a pass that runs twice says it once", () => {
    assert.equal(fineKey("e1", SUNDAY), "LOCATION_FINE:e1:2026-10-04");
    assert.equal(warningKey(1, "e1", SUNDAY), "LOCATION_WARNING:1:e1:2026-10-04");
    assert.notEqual(warningKey(1, "e1", SUNDAY), warningKey(2, "e1", SUNDAY));
    // Turned off and on again is a new announcement, and a new notice.
    assert.notEqual(noticeKey("e1", "2026-10-01T09:00:00.000Z"), noticeKey("e1", "2026-10-02T09:00:00.000Z"));
  });

  it("is never silenced by the person's preferences", () => {
    const allOff = { ...DEFAULT_PREFERENCES, chatMessages: false, taskAssigned: false, taskUpdated: false, todaySchedule: false, tomorrowSchedule: false, deadlineReminders: false };
    assert.equal(isTypeEnabled("LOCATION_REMINDER", allOff), true);
  });
});

describe("the wiring the fine depends on", () => {
  const root = process.cwd();
  // Line endings normalised: git checks this repository out with CRLF on
  // Windows, where the office PC verifies every deploy, and a pattern written
  // with a newline escape then matches nothing. These assertions are about the
  // code, not about which machine read it.
  const read = (...path: string[]) => readFileSync(join(root, ...path), "utf8").replace(/\r\n/g, "\n");
  const body = (source: string, signature: string) => {
    const start = source.indexOf(signature);
    assert.ok(start >= 0, `${signature} not found`);
    return source.slice(start, source.indexOf("\n}\n", start));
  };

  it("gives the switch and the undo to the manager alone", () => {
    const team = read("src", "lib", "mobile", "registry", "team.ts");
    assert.match(team, /"team\/locations\/fine": guardedAction\(requireAdmin, /);
    assert.match(team, /"team\/locations\/forgive": guardedAction\(requireAdmin, /);
  });

  it("counts a kept position in the write itself, so two at once both count", () => {
    const store = read("src", "lib", "location-fine-store.ts");
    assert.match(body(store, "export async function countFix("), /fixes: \{ increment: 1 \}/);
    const service = read("src", "lib", "mobile", "location-service.ts");
    assert.match(body(service, "export async function reportLocation("), /if \(kept\) await countFix\(/);
  });

  it("reads the phone's and the map's side of it without changing anything", () => {
    const store = read("src", "lib", "location-fine-store.ts");
    for (const signature of ["export async function phoneFine(", "export async function mapFine(", "async function ruleNow(", "async function chargedIn("]) {
      assert.doesNotMatch(body(store, signature), /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|setSetting|\$executeRaw|dispatchNotification/);
    }
    const service = read("src", "lib", "mobile", "location-service.ts");
    assert.doesNotMatch(body(service, "export async function locationPlanFor("), /countFix|\.(create|update|upsert)/);
  });

  it("counts the month again from its days, one count at a time", () => {
    const recount = body(read("src", "lib", "location-fine-store.ts"), "export async function recountMonth(");
    assert.match(recount, /pg_advisory_xact_lock/);
    assert.match(recount, /monthAdjustment\(/);
    assert.match(recount, /salaryAdjustment\.deleteMany/);
  });

  it("runs on the location keeper's pass, after the map's own work", () => {
    const keeper = read("src", "lib", "notifications", "location-keeper.ts");
    const run = body(keeper, "export async function runLocationKeeper(");
    assert.ok(run.indexOf("keepPositions(") < run.indexOf("runLocationFines("));
    assert.match(run, /runLocationFines\(now, today\)\.catch\(/);
  });

  it("never asks the fingerprint device", () => {
    for (const path of [
      ["src", "lib", "notifications", "location-fines.ts"],
      ["src", "lib", "location-fine-store.ts"],
      ["src", "lib", "location-fine.ts"],
    ]) {
      assert.doesNotMatch(read(...path), /attendance-sync|attendance-device|syncAttendance/);
    }
  });
});
