import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  atOffice,
  byStateThenName,
  fixOf,
  isOpen,
  KEEPER_MINUTES,
  LOCATION_WAKE,
  locationWindow,
  metresBetween,
  nextWindowStart,
  officeFromArgs,
  parseReport,
  personRow,
  personState,
  readOffice,
  readPermission,
  REFRESH_MINUTES,
  sharePlan,
  shownFix,
  STATE_ORDER,
  whoToPing,
  type Fix,
  type PersonFacts,
  type PingCandidate,
} from "../src/lib/staff-location";
import { backgroundBody } from "../src/lib/notifications/apns";
import { RpcError } from "../src/lib/mobile/rpc";
import { CRON_JOBS } from "../src/lib/status";
import { DEFAULT_WORK_HOURS } from "../src/lib/work-hours";
import { dayKeyIn } from "../src/lib/time";

// Where the team is. Everything the manager's map may show, and everything a
// phone may send, is decided by these functions — so the privacy rules are
// here, pinned: nothing outside today's working window, nothing after the
// device saw somebody clock out, only the latest position. Get one wrong and
// the map still looks right; it just shows somebody's evening.

const tz = "Asia/Amman"; // UTC+3 all year
const hours = { ...DEFAULT_WORK_HOURS, start: "11:00", end: "19:00" }; // Sunday to Thursday
const SUNDAY = "2026-10-04";
const THURSDAY = "2026-10-08";
const FRIDAY = "2026-10-09";
const at = (day: string, time: string) => new Date(`${day}T${time}+03:00`);
const window = locationWindow(hours, SUNDAY, tz)!;
const MIN = 60_000;
const ago = (now: Date, ms: number) => new Date(now.getTime() - ms);

const office = { latitude: 31.95, longitude: 35.91 };
const fixAt = (fixedAt: Date, place = office, accuracy: number | null = 20): Fix => ({ ...place, accuracy, fixedAt });
const facts = (overrides: Partial<PersonFacts>): PersonFacts => ({
  now: at(SUNDAY, "12:00"),
  window,
  departedAt: null,
  permission: "always",
  fix: null,
  ...overrides,
});

describe("today's working window", () => {
  it("is the working hours in the studio's timezone, and nothing on a day off", () => {
    assert.equal(window.start.toISOString(), "2026-10-04T08:00:00.000Z");
    assert.equal(window.end.toISOString(), "2026-10-04T16:00:00.000Z");
    assert.equal(locationWindow(hours, FRIDAY, tz), null);
    assert.equal(locationWindow(hours, "2026-10-10", tz), null); // Saturday
  });

  it("is open from the start up to, and not including, the end", () => {
    assert.equal(isOpen(window, at(SUNDAY, "10:59:59")), false);
    assert.equal(isOpen(window, at(SUNDAY, "11:00")), true);
    assert.equal(isOpen(window, at(SUNDAY, "18:59:59")), true);
    assert.equal(isOpen(window, at(SUNDAY, "19:00")), false);
    assert.equal(isOpen(null, at(SUNDAY, "12:00")), false);
  });

  it("opens next later today, else on the next working day", () => {
    assert.equal(nextWindowStart(hours, at(SUNDAY, "09:00"), tz)?.toISOString(), "2026-10-04T08:00:00.000Z");
    // At the very start the window is open, so the next one is tomorrow's.
    assert.equal(nextWindowStart(hours, at(SUNDAY, "11:00"), tz)?.toISOString(), "2026-10-05T08:00:00.000Z");
    // After Thursday's, past the weekend to Sunday.
    assert.equal(nextWindowStart(hours, at(THURSDAY, "19:30"), tz)?.toISOString(), "2026-10-11T08:00:00.000Z");
    assert.equal(nextWindowStart(hours, at(FRIDAY, "12:00"), tz)?.toISOString(), "2026-10-11T08:00:00.000Z");
    assert.equal(nextWindowStart({ ...hours, days: [] }, at(SUNDAY, "09:00"), tz), null);
  });

  it("follows Amman's calendar, not the server's", () => {
    // 21:30 UTC on Saturday is already 00:30 on Sunday in Amman.
    const sundayNight = new Date("2026-10-03T21:30:00Z");
    assert.equal(dayKeyIn(tz, sundayNight), SUNDAY);
    assert.equal(nextWindowStart(hours, sundayNight, tz)?.toISOString(), "2026-10-04T08:00:00.000Z");

    // 21:30 UTC on Thursday is Friday in Amman: a day off, though UTC still says Thursday.
    const fridayNight = new Date("2026-10-08T21:30:00Z");
    const today = dayKeyIn(tz, fridayNight);
    assert.equal(today, FRIDAY);
    const plan = sharePlan({ now: fridayNight, window: locationWindow(hours, today, tz), nextStartsAt: null, departedAt: null });
    assert.equal(plan.reason, "day-off");
  });
});

describe("what a phone is told (me/location)", () => {
  const next = new Date("2026-10-05T08:00:00Z");
  const plan = (now: Date, departedAt: Date | null = null, dayOff = false) =>
    sharePlan({ now, window, nextStartsAt: next, departedAt, dayOff });

  it("shares inside the window, and says nothing is wrong", () => {
    assert.deepEqual(plan(at(SUNDAY, "11:00")), {
      sharing: true,
      reason: null,
      startsAt: window.start,
      endsAt: window.end,
      nextStartsAt: next,
    });
  });

  it("does not share before the start or from the end", () => {
    assert.deepEqual(plan(at(SUNDAY, "10:59")), { sharing: false, reason: "before-hours", startsAt: window.start, endsAt: window.end, nextStartsAt: next });
    assert.equal(plan(at(SUNDAY, "19:00")).reason, "after-hours");
    assert.equal(plan(at(SUNDAY, "19:00")).sharing, false);
  });

  it("stops once the device has seen them clock out — at that minute, not before", () => {
    assert.equal(plan(at(SUNDAY, "16:00"), at(SUNDAY, "16:00")).reason, "clocked-out");
    assert.equal(plan(at(SUNDAY, "16:00"), at(SUNDAY, "16:01")).sharing, true);
    // After hours, the window is the reason, whatever the device saw.
    assert.equal(plan(at(SUNDAY, "19:30"), at(SUNDAY, "18:00")).reason, "after-hours");
  });

  it("says day-off on a day nobody works, with no window to give", () => {
    const friday = sharePlan({ now: at(FRIDAY, "12:00"), window: null, nextStartsAt: next, departedAt: null });
    assert.deepEqual(friday, { sharing: false, reason: "day-off", startsAt: null, endsAt: null, nextStartsAt: next });
    // One person's day off, inside the studio's window.
    assert.equal(plan(at(SUNDAY, "12:00"), null, true).reason, "day-off");
  });
});

describe("what the manager sees of one person", () => {
  const now = at(SUNDAY, "12:00");

  it("is live up to five minutes, recent up to twenty, then stale", () => {
    const state = (age: number) => personState(facts({ now, fix: fixAt(ago(now, age)) }));
    assert.equal(state(0), "live");
    assert.equal(state(5 * MIN), "live");
    assert.equal(state(5 * MIN + 1), "recent");
    assert.equal(state(20 * MIN), "recent");
    assert.equal(state(20 * MIN + 1), "stale");
    // A phone clock a little ahead is believed, and is simply fresh.
    assert.equal(state(-60_000), "live");
  });

  it("is waiting while the phone has sent nothing from today's window", () => {
    assert.equal(personState(facts({ now })), "waiting");
    // Taken before the day began: not the map's to show.
    const early = facts({ now, fix: fixAt(at(SUNDAY, "10:58")) });
    assert.equal(personState(early), "waiting");
    assert.equal(shownFix(early), null);
    // Left over from yesterday, on a day the keeper did not run.
    assert.equal(shownFix(facts({ now, fix: fixAt(at("2026-10-01", "15:00")) })), null);
  });

  it("is off when the phone's switch is, and keeps where they were when it went off", () => {
    const earlier = fixAt(at(SUNDAY, "11:30"));
    const denied = facts({ now, permission: "denied", fix: earlier });
    assert.equal(personState(denied), "off");
    assert.deepEqual(shownFix(denied), earlier);
    assert.equal(personState(facts({ now, permission: "restricted" })), "off");
    assert.equal(shownFix(facts({ now, permission: "restricted" })), null);
    assert.equal(shownFix(facts({ now, permission: "denied", fix: fixAt(at("2026-10-01", "15:00")) })), null);
  });

  it("shows nothing once the device has seen them clock out, however fresh the position", () => {
    const out = facts({ now, departedAt: at(SUNDAY, "11:50"), fix: fixAt(ago(now, MIN)) });
    assert.equal(personState(out), "clocked-out");
    assert.equal(shownFix(out), null);
  });

  it("shows nothing outside the window, and calls a day nobody works a day off", () => {
    const evening = facts({ now: at(SUNDAY, "19:05"), fix: fixAt(at(SUNDAY, "18:59")) });
    assert.equal(personState(evening), "closed");
    assert.equal(shownFix(evening), null);
    assert.equal(personState(facts({ now: at(SUNDAY, "10:00") })), "closed");
    assert.equal(personState(facts({ now: at(FRIDAY, "12:00"), window: null })), "day-off");
    assert.equal(personState(facts({ now, dayOff: true, fix: fixAt(ago(now, MIN)) })), "day-off");
  });

  it("never hands over a stored row that has no position in it", () => {
    assert.equal(fixOf(null), null);
    assert.equal(fixOf({ latitude: null, longitude: null, accuracy: null, fixedAt: null, permission: "always", precise: true }), null);
    assert.equal(fixOf({ latitude: 31.9, longitude: 35.9, accuracy: null, fixedAt: null, permission: "always", precise: true }), null);
  });

  it("knows only the permissions the app sends", () => {
    assert.equal(readPermission("when-in-use"), "when-in-use");
    assert.equal(readPermission("unknown"), "unknown");
    assert.equal(readPermission("whatever"), "unknown");
    assert.equal(readPermission(null), "unknown");
  });
});

describe("a row of team/locations", () => {
  const now = at(SUNDAY, "12:00");
  const person = { id: "e1", name: "Lina", photoUrl: "/uploads/faces/e1.jpg", role: "3D Visualizer" };
  const stored = (fixedAt: Date | null, permission = "always") => ({
    latitude: fixedAt ? 31.951 : null,
    longitude: fixedAt ? 35.91 : null,
    accuracy: fixedAt ? 25 : null,
    fixedAt,
    permission,
    precise: false,
  });

  it("carries the position, the office and the device's times for somebody live", () => {
    const row = personRow({
      person,
      stored: stored(ago(now, 2 * MIN)),
      attendance: { arrivedAt: at(SUNDAY, "10:57"), departedAt: null },
      now,
      window,
      office,
    });
    assert.deepEqual(row, {
      id: "e1",
      name: "Lina",
      photoUrl: "/uploads/faces/e1.jpg",
      role: "3D Visualizer",
      state: "live",
      latitude: 31.951,
      longitude: 35.91,
      accuracy: 25,
      fixedAt: ago(now, 2 * MIN),
      precise: false,
      permission: "always",
      atOffice: true,
      metresFromOffice: 111,
      arrivedAt: at(SUNDAY, "10:57"),
      departedAt: null,
    });
  });

  it("has no coordinates, and no office answer, whenever none may be shown", () => {
    const closed = personRow({ person, stored: stored(at(SUNDAY, "18:59")), attendance: null, now: at(SUNDAY, "19:05"), window, office });
    assert.equal(closed.state, "closed");
    assert.deepEqual(
      [closed.latitude, closed.longitude, closed.accuracy, closed.fixedAt, closed.atOffice, closed.metresFromOffice],
      [null, null, null, null, null, null]
    );

    const out = personRow({
      person,
      stored: stored(ago(now, MIN)),
      attendance: { arrivedAt: at(SUNDAY, "11:00"), departedAt: at(SUNDAY, "11:45") },
      now,
      window,
      office,
    });
    assert.equal(out.state, "clocked-out");
    assert.equal(out.latitude, null);
    assert.equal(out.departedAt?.toISOString(), at(SUNDAY, "11:45").toISOString());
  });

  it("is waiting, with the phone's defaults, for somebody whose phone has said nothing", () => {
    const row = personRow({ person, stored: null, attendance: null, now, window, office: null });
    assert.equal(row.state, "waiting");
    assert.equal(row.permission, "unknown");
    assert.equal(row.precise, true);
    assert.equal(row.atOffice, null);
  });

  it("leaves the office answer out until the office is set", () => {
    const row = personRow({ person, stored: stored(ago(now, MIN)), attendance: null, now, window, office: null });
    assert.equal(row.latitude, 31.951);
    assert.equal(row.atOffice, null);
    assert.equal(row.metresFromOffice, null);
  });

  it("lists who can be seen first, then why the rest cannot, then by name", () => {
    const rows = [
      { state: "closed" as const, name: "A" },
      { state: "waiting" as const, name: "Zed" },
      { state: "live" as const, name: "Omar" },
      { state: "off" as const, name: "B" },
      { state: "waiting" as const, name: "Adam" },
      { state: "live" as const, name: "Hala" },
      { state: "clocked-out" as const, name: "C" },
      { state: "day-off" as const, name: "D" },
      { state: "stale" as const, name: "E" },
      { state: "recent" as const, name: "F" },
    ];
    assert.deepEqual(
      [...rows].sort(byStateThenName).map((row) => `${row.state}:${row.name}`),
      ["live:Hala", "live:Omar", "recent:F", "stale:E", "off:B", "waiting:Adam", "waiting:Zed", "clocked-out:C", "day-off:D", "closed:A"]
    );
    assert.deepEqual(STATE_ORDER, ["live", "recent", "stale", "off", "waiting", "clocked-out", "day-off", "closed"]);
  });
});

describe("distance, and being at the office", () => {
  it("measures along the ground", () => {
    // A degree of latitude on a 6,371 km sphere.
    assert.ok(Math.abs(metresBetween({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }) - 111_195) < 1);
    assert.equal(metresBetween(office, office), 0);
    const there = { latitude: 31.96, longitude: 35.93 };
    assert.equal(metresBetween(office, there), metresBetween(there, office));
  });

  it("counts within 150 m, after taking off up to 100 m of the fix's own accuracy", () => {
    const north = (metres: number) => ({ latitude: office.latitude + metres / 111_195, longitude: office.longitude });
    assert.equal(atOffice({ ...north(140), accuracy: null }, office), true);
    assert.equal(atOffice({ ...north(160), accuracy: null }, office), false);
    assert.equal(atOffice({ ...north(220), accuracy: 80 }, office), true); // 220 − 80 = 140
    assert.equal(atOffice({ ...north(220), accuracy: 60 }, office), false); // 220 − 60 = 160
    // A fix good only to a kilometre is given 100 m of benefit, not a kilometre.
    assert.equal(atOffice({ ...north(240), accuracy: 1000 }, office), true); // 240 − 100 = 140
    assert.equal(atOffice({ ...north(260), accuracy: 1000 }, office), false); // 260 − 100 = 160
  });
});

describe("reading a position from the phone", () => {
  const now = at(SUNDAY, "12:00");
  const args = (overrides: Partial<Record<0 | 1 | 2 | 3 | 4, unknown>> = {}) => {
    const list: unknown[] = [31.95, 35.91, 12.5, "2026-10-04T08:59:30Z", true];
    for (const [index, value] of Object.entries(overrides)) list[Number(index)] = value;
    return list;
  };

  it("reads a good one", () => {
    assert.deepEqual(parseReport(args(), now), {
      latitude: 31.95,
      longitude: 35.91,
      accuracy: 12.5,
      fixedAt: new Date("2026-10-04T08:59:30Z"),
      precise: true,
    });
    // Numbers as text, an offset, a fraction, and precise as the form would send it.
    const loose = parseReport(args({ 0: "31.95", 1: "-35.5", 3: "2026-10-04T11:59:30.250+03:00", 4: "false" }), now);
    assert.equal(loose.latitude, 31.95);
    assert.equal(loose.longitude, -35.5);
    assert.equal(loose.fixedAt.toISOString(), "2026-10-04T08:59:30.250Z");
    assert.equal(loose.precise, false);
    assert.equal(parseReport(args({ 4: undefined }), now).precise, false);
  });

  it("refuses coordinates that are not on the Earth, with a sentence", () => {
    for (const latitude of [90.0001, -91, "north", null, true, Number.NaN]) {
      assert.throws(() => parseReport(args({ 0: latitude }), now), RpcError);
    }
    assert.equal(parseReport(args({ 0: -90, 1: 180 }), now).longitude, 180);
    for (const longitude of [180.5, -181, undefined, Number.POSITIVE_INFINITY]) {
      assert.throws(() => parseReport(args({ 1: longitude }), now), RpcError);
    }
    assert.throws(() => parseReport(args({ 0: 95 }), now), /latitude must be a number from -90 to 90/);
  });

  it("refuses an accuracy that is not a number of metres it could keep", () => {
    assert.equal(parseReport(args({ 2: 0 }), now).accuracy, 0);
    assert.equal(parseReport(args({ 2: 50_000 }), now).accuracy, 50_000);
    for (const accuracy of [-1, 50_001, null, "far", Number.NaN]) {
      assert.throws(() => parseReport(args({ 2: accuracy }), now), RpcError);
    }
  });

  it("believes a time up to two minutes ahead and up to fifteen minutes old, and no further", () => {
    const iso = (date: Date) => date.toISOString();
    assert.ok(parseReport(args({ 3: iso(new Date(now.getTime() + 2 * MIN)) }), now));
    assert.throws(() => parseReport(args({ 3: iso(new Date(now.getTime() + 2 * MIN + 1000)) }), now), /ahead of the server's clock/);
    assert.ok(parseReport(args({ 3: iso(ago(now, 15 * MIN)) }), now));
    assert.throws(() => parseReport(args({ 3: iso(ago(now, 15 * MIN + 1000)) }), now), /more than 15 minutes old/);
  });

  it("wants an instant with its zone, not a wall-clock time", () => {
    for (const fixedAt of ["2026-10-04T11:59:30", "2026-10-04", "yesterday", 1_790_000_000_000, null]) {
      assert.throws(() => parseReport(args({ 3: fixedAt }), now), /ISO date with its timezone/);
    }
  });
});

describe("whose phone is woken for a fresh position", () => {
  const now = at(SUNDAY, "12:00");
  const person = (overrides: Partial<PingCandidate>): PingCandidate => ({
    id: "e1",
    permission: "always",
    fixedAt: null,
    pingedAt: null,
    departedAt: null,
    ...overrides,
  });
  const due = (people: PingCandidate[], minutes = KEEPER_MINUTES, when = now) =>
    whoToPing({ now: when, window, people, quietMinutes: minutes });

  it("wakes everybody without a position at the start of the day, and nobody outside the window", () => {
    const team = [person({ id: "a" }), person({ id: "b", pingedAt: at("2026-10-01", "18:50") })];
    assert.deepEqual(due(team, KEEPER_MINUTES, at(SUNDAY, "11:00")), ["a", "b"]);
    assert.deepEqual(due(team, KEEPER_MINUTES, at(SUNDAY, "10:59")), []);
    assert.deepEqual(due(team, KEEPER_MINUTES, at(SUNDAY, "19:00")), []);
    assert.deepEqual(whoToPing({ now, window: null, people: team, quietMinutes: KEEPER_MINUTES }), []);
  });

  it("leaves a phone alone while its position is no older than the span", () => {
    assert.deepEqual(due([person({ fixedAt: ago(now, 10 * MIN) })]), []);
    assert.deepEqual(due([person({ fixedAt: ago(now, 10 * MIN + 1000) })]), ["e1"]);
    assert.deepEqual(due([person({ fixedAt: ago(now, 2 * MIN) })], REFRESH_MINUTES), []);
    assert.deepEqual(due([person({ fixedAt: ago(now, 2 * MIN + 1000) })], REFRESH_MINUTES), ["e1"]);
  });

  it("does not ask a phone again within the span", () => {
    assert.deepEqual(due([person({ pingedAt: ago(now, 10 * MIN - 1000) })]), []);
    assert.deepEqual(due([person({ pingedAt: ago(now, 10 * MIN) })]), ["e1"]);
    assert.deepEqual(due([person({ pingedAt: ago(now, 2 * MIN - 1000) })], REFRESH_MINUTES), []);
    assert.deepEqual(due([person({ pingedAt: ago(now, 2 * MIN) })], REFRESH_MINUTES), ["e1"]);
    // Both rules at once: a stale position, but asked a minute ago.
    assert.deepEqual(due([person({ fixedAt: ago(now, 30 * MIN), pingedAt: ago(now, MIN) })]), []);
  });

  it("never wakes a phone whose switch is off, or somebody clocked out or off for the day", () => {
    assert.deepEqual(due([person({ permission: "denied" }), person({ id: "r", permission: "restricted" })]), []);
    assert.deepEqual(due([person({ departedAt: at(SUNDAY, "11:40") })]), []);
    assert.deepEqual(due([person({ dayOff: true })]), []);
    // Not asked yet, or only allowed while in use: still worth asking.
    assert.deepEqual(due([person({ permission: "not-determined" }), person({ id: "w", permission: "when-in-use" })]), ["e1", "w"]);
  });
});

describe("the office", () => {
  it("reads back what was stored, and nothing it cannot read", () => {
    assert.deepEqual(readOffice('{"latitude":31.95,"longitude":35.91}'), office);
    assert.equal(readOffice("null"), null);
    assert.equal(readOffice(null), null);
    assert.equal(readOffice("not json"), null);
    assert.equal(readOffice('{"latitude":"31.9","longitude":35.9}'), null);
    assert.equal(readOffice('{"latitude":131.9,"longitude":35.9}'), null);
  });

  it("is set by [latitude, longitude] and cleared by [] or [null]", () => {
    assert.deepEqual(officeFromArgs([31.95, 35.91]), office);
    assert.deepEqual(officeFromArgs(["31.95", "35.91"]), office);
    assert.equal(officeFromArgs([]), null);
    assert.equal(officeFromArgs([null]), null);
    assert.throws(() => officeFromArgs([31.95]), RpcError);
    assert.throws(() => officeFromArgs([91, 35.91]), RpcError);
    assert.throws(() => officeFromArgs([31.95, "east"]), RpcError);
  });
});

describe("the silent push that asks a phone for its position", () => {
  it("is exactly what the app listens for", () => {
    assert.equal(JSON.stringify(backgroundBody(LOCATION_WAKE)), '{"aps":{"content-available":1},"neon":{"kind":"location"}}');
  });
});

describe("the wiring the map depends on", () => {
  const root = process.cwd();
  // Line endings normalised: git checks this repository out with CRLF on
  // Windows, where the office PC verifies every deploy, and a pattern written
  // with a newline escape then matches nothing. These assertions are about the
  // code, not about which machine read it.
  const read = (...path: string[]) =>
    readFileSync(join(root, ...path), "utf8").replace(/\r\n/g, "\n");

  it("gives the phone's side to the employee and the map to the manager alone", () => {
    const me = read("src", "lib", "mobile", "registry", "me.ts");
    assert.match(me, /"me\/location": guarded\(requireEmployee, /);
    assert.match(me, /"me\/location\/report": guardedAction\(requireEmployee, /);
    assert.match(me, /"me\/location\/permission": guardedAction\(requireEmployee, /);

    const team = read("src", "lib", "mobile", "registry", "team.ts");
    assert.match(team, /"team\/locations": guarded\(requireAdmin, /);
    assert.match(team, /"team\/locations\/refresh": guardedAction\(requireAdmin, /);
    assert.match(team, /"team\/locations\/office": guardedAction\(requireAdmin, /);
  });

  it("reads the map without changing anything", () => {
    const service = read("src", "lib", "mobile", "location-service.ts");
    const start = service.indexOf("export async function teamLocations(");
    const body = service.slice(start, service.indexOf("\n}\n", start));
    assert.ok(start > 0 && body.length > 0);
    assert.doesNotMatch(body, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|wakePhones|wipePositions|setSetting/);
  });

  it("runs the keeper every minute, beside the clock reminders", () => {
    assert.ok((CRON_JOBS as readonly string[]).includes("location"));
    assert.match(read("src", "app", "api", "cron", "notifications", "route.ts"), /forced === "location" \|\| !forced/);
    assert.match(read("docker-compose.yml"), /for job in meetings clock location; do/);
  });
});
