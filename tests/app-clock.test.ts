import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  appPunchKey,
  asPunches,
  DOUBLE_TAP_SECONDS,
  isDoubleTap,
  mapLink,
  readClockFix,
  recordedPunches,
} from "../src/lib/app-clock";
import { attendanceFromPunches } from "../src/lib/attendance";
import { DEFAULT_WORK_HOURS } from "../src/lib/work-hours";
import { Refusal } from "../src/lib/refusal";

// Clocking in from the app, with where it was done — asked for Wael on
// 2026-11-17: "بس يبصم من البرنامج يسجل البصمة باللوكيشن الي هو موجود فيه".

const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), "utf8");
const now = new Date("2026-11-17T08:00:00Z");
const fresh = { latitude: 31.9539, longitude: 35.9106, accuracy: 12, fixedAt: "2026-11-17T07:59:30Z" };

describe("the position a punch is made with", () => {
  it("is taken when it is real and fresh", () => {
    assert.deepEqual(readClockFix(fresh, now), { latitude: 31.9539, longitude: 35.9106, accuracy: 12 });
  });

  it("is required — a punch without a place is refused in words", () => {
    for (const bad of [
      { ...fresh, latitude: null },
      { ...fresh, longitude: "x" },
      { ...fresh, latitude: 91 },
      { ...fresh, latitude: 0, longitude: 0 },
      { ...fresh, accuracy: undefined },
      { ...fresh, fixedAt: "yesterday" },
    ]) {
      assert.throws(() => readClockFix(bad, now), Refusal, JSON.stringify(bad));
    }
  });

  it("is not an old one from the drive over, nor from a phone whose clock runs ahead", () => {
    assert.throws(() => readClockFix({ ...fresh, fixedAt: "2026-11-17T07:57:00Z" }, now), /old/);
    assert.throws(() => readClockFix({ ...fresh, fixedAt: "2026-11-17T08:05:00Z" }, now), /clock is ahead/);
  });

  it("is not a guess that covers half the city", () => {
    assert.throws(() => readClockFix({ ...fresh, accuracy: 8000 }, now), /precise location/);
  });
});

describe("a punch from the app", () => {
  it("pressed twice inside a minute is one punch", () => {
    const last = new Date("2026-11-17T07:59:30Z");
    assert.equal(isDoubleTap(last, now), true);
    assert.equal(isDoubleTap(new Date(now.getTime() - DOUBLE_TAP_SECONDS * 1000), now), false);
    assert.equal(isDoubleTap(null, now), false);
  });

  it("is filed under the person's device number, so it and the fingerprint make one day", () => {
    const punches = asPunches(
      [
        { employeeId: "wael", at: new Date("2026-11-17T16:10:00Z") },
        { employeeId: "nobody-on-the-device", at: new Date("2026-11-17T08:00:00Z") },
      ],
      (id) => (id === "wael" ? "4" : null)
    );
    assert.deepEqual(
      punches.map((punch) => [punch.deviceUserId, punch.fromApp]),
      [
        ["4", true],
        [appPunchKey("nobody-on-the-device"), true],
      ]
    );

    // In at the door at 11:00 Amman, out from a site at 19:10.
    const hours = { ...DEFAULT_WORK_HOURS, days: [0, 1, 2, 3, 4, 6] };
    const days = attendanceFromPunches(
      [{ deviceUserId: "4", at: new Date("2026-11-17T08:00:00Z") }, punches[0]],
      hours,
      "Asia/Amman"
    );
    assert.equal(days.length, 1);
    assert.equal(days[0].arrivedLocal, "11:00 AM");
    assert.equal(days[0].departedLocal, "7:10 PM");
    assert.equal(days[0].appReads, 1);
  });

  it("written without the device keeps the reads the day already has", () => {
    const arrived = new Date("2026-11-17T08:00:00Z");
    const left = new Date("2026-11-17T15:00:00Z");
    assert.deepEqual(
      recordedPunches({ source: "DEVICE", arrivedAt: arrived, departedAt: left }, "4").map((p) => p.at),
      [arrived, left]
    );
    // The manager's arrival is not a read; the device's departure is.
    assert.deepEqual(
      recordedPunches({ source: "ARRIVAL", arrivedAt: arrived, departedAt: left }, "4").map((p) => p.at),
      [left]
    );
    assert.deepEqual(recordedPunches({ source: "MANUAL", arrivedAt: arrived, departedAt: left }, "4"), []);
    assert.deepEqual(recordedPunches(null, "4"), []);
  });

  it("opens on a map anywhere", () => {
    assert.equal(mapLink({ latitude: 31.9539, longitude: 35.9106 }), "https://www.google.com/maps?q=31.953900,35.910600");
  });
});

describe("where it is wired in", () => {
  it("is read by every sync beside the device's own log", () => {
    const sync = read("src", "lib", "attendance-sync.ts");
    assert.match(sync, /\[\.\.\.devicePunches, \.\.\.\(sinceAt \? await appPunchesSince\(sinceAt\) : \[\]\)\]/);
    // A punch from a site lands without waiting for the device, after any sync already running.
    assert.match(sync, /export async function writeAppDay[\s\S]*?if \(running\) await running/);
  });

  it("is only for whoever the manager turned it on for", () => {
    const store = read("src", "lib", "app-clock-store.ts");
    assert.match(store, /if \(!person\?\.active \|\| !person\.appClockIn\) \{\s*throw new Refusal/);
  });

  it("takes the person from the session and the time from the server, on the site and in the phone app", () => {
    const action = read("src", "lib", "actions", "app-clock-actions.ts");
    assert.match(action, /const employee = await requireEmployee\(\);/);
    assert.match(action, /recordAppPunch\(employee\.id, fix, now\)/);
    const phone = read("src", "lib", "mobile", "registry", "me.ts");
    assert.match(phone, /"me\/clock": guarded\(requireEmployee/);
    assert.match(phone, /"me\/clock": guardedAction\(requireEmployee/);
  });

  // Wael, 2026-11-21: in on the fingerprint, the app offered "Clock in here"
  // all day, so a clock-out from a site looked impossible.
  it("says Clock out once the day has an arrival, from the fingerprint too", () => {
    const phone = read("src", "lib", "mobile", "registry", "me.ts");
    assert.match(phone, /clockedIn: punches\.length > 0 \|\| record\?\.arrivedAt != null/);
    const card = read("ios", "Sources", "Features", "Me", "AppClockCard.swift");
    assert.match(card, /\(clock\.clockedIn \?\? !clock\.punches\.isEmpty\) \? L\("Clock out here"\) : L\("Clock in here"\)/);
  });

  it("shows the manager where each one was made", () => {
    const page = read("src", "app", "admin", "(dashboard)", "attendance", "page.tsx");
    assert.match(page, /<AppPunchList punches=\{appPunches\}/);
  });
});
