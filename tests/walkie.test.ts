import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  readWalkieSeconds,
  readWalkieTarget,
  walkieHoursOpen,
  walkiePayload,
  walkiePressAllowed,
  WALKIE_MAX_SECONDS,
} from "@/lib/walkie";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

describe("the walkie-talkie", () => {
  it("wakes the phone with everything it needs to play", () => {
    const payload = walkiePayload({ id: "w1", audioUrl: "https://x/a.m4a", seconds: 4, fromName: "Hamed", fromKey: "admin", scope: "one" });
    assert.equal(payload.activeSpeaker, "Hamed");
    assert.deepEqual(payload.neon, {
      kind: "walkie", id: "w1", audioUrl: "https://x/a.m4a", seconds: 4, from: "Hamed", fromKey: "admin", scope: "one",
    });
  });

  it("reads a length as whole seconds, within the limit", () => {
    assert.equal(readWalkieSeconds("3.6"), 4);
    assert.equal(readWalkieSeconds("0.2"), 1);
    assert.equal(readWalkieSeconds(9999), WALKIE_MAX_SECONDS);
    assert.equal(readWalkieSeconds(""), null);
    assert.equal(readWalkieSeconds("-2"), null);
  });

  it("goes to everybody, the manager, or one person — nothing else", () => {
    assert.deepEqual(readWalkieTarget("all"), { kind: "all" });
    assert.deepEqual(readWalkieTarget("admin"), { kind: "manager" });
    assert.deepEqual(readWalkieTarget("cmtu0pias000h3ld6ordifpi4"), { kind: "person", id: "cmtu0pias000h3ld6ordifpi4" });
    assert.equal(readWalkieTarget(""), null);
    assert.equal(readWalkieTarget(42), null);
  });

  // 10:00 until 19:00, every day.
  it("is open from ten in the morning until seven in the evening", () => {
    assert.equal(walkieHoursOpen("09:59"), false);
    assert.equal(walkieHoursOpen("10:00"), true);
    assert.equal(walkieHoursOpen("15:30"), true);
    assert.equal(walkieHoursOpen("18:59"), true);
    assert.equal(walkieHoursOpen("19:00"), false);
    assert.equal(walkieHoursOpen("23:30"), false);
    assert.equal(walkieHoursOpen("02:00"), false);
    // A span across midnight still reads both sides of it.
    assert.equal(walkieHoursOpen("02:00", "22:00", "04:00"), true);
  });

  // The studio's rule, checked before anything is stored.
  // It used to refuse outright outside 10:00-19:00. It narrows instead now,
  // so what is pinned is that every press goes through the rule, and that a
  // refusal says which half was missing rather than going quiet at midnight.
  it("puts every press through the night rule rather than closing", () => {
    const store = read("src", "lib", "walkie-store.ts");
    assert.ok(store.includes("walkiePressAllowed({"), "every press is checked");
    assert.ok(store.includes("reason: verdict.reason"), "a refusal says which half was missing");
    assert.ok(!store.includes("reason: \"closed\""), "the hours no longer close it");
  });

  // Only a phone whose owner turned it on has a PTT token, and only those are
  // sent to: a send that went by anything else would reach a phone nobody agreed to.
  it("is sent only to the phones whose owner turned it on", () => {
    const store = read("src", "lib", "walkie-store.ts");
    assert.match(store, /deviceTokens: \{ where: \{ active: true, kind: "PTT" \} \}/);
    assert.match(store, /sendPushToTalk\(/);
  });

  // "Heard" is only ever said by the phone it was for.
  it("is marked heard only by whoever it was for", () => {
    const store = read("src", "lib", "walkie-store.ts");
    assert.match(store, /where: \{ id, toKey: speakerKey\(speaker\), heardAt: null \}/);
  });

  it("is anybody's in the studio to use, and nobody's else", () => {
    const registry = read("src", "lib", "mobile", "registry", "walkie.ts");
    assert.match(registry, /"walkie\/send": guardedAction\(requireStaff/);
    assert.match(registry, /"walkie\/leave": guardedAction\(requireStaff/);
  });
});

describe("the walkie-talkie at night", () => {
  // It runs around the clock now. Inside 10:00-19:00 it is a room everybody is
  // in; outside them it is a line between the two people the studio allows at
  // night, and nobody else — the manager included.
  const day = "14:00";
  const night = "21:30";
  const late = { late: true };
  const anyoneElse = { late: false };

  it("is open to anybody, and to everybody at once, inside the hours", () => {
    assert.equal(walkiePressAllowed({ wallClock: day, speaker: anyoneElse, target: { kind: "all" } }).ok, true);
    assert.equal(
      walkiePressAllowed({ wallClock: day, speaker: anyoneElse, target: { kind: "person", id: "x" }, listener: anyoneElse }).ok,
      true
    );
  });

  it("is not a room at night: one person to one person, never everybody", () => {
    const all = walkiePressAllowed({ wallClock: night, speaker: late, target: { kind: "all" } });
    assert.equal(all.ok, false);
    assert.equal(all.ok === false && all.reason, "night-all");
  });

  it("is only the two the studio allows, talking to each other", () => {
    assert.equal(
      walkiePressAllowed({ wallClock: night, speaker: late, target: { kind: "person", id: "x" }, listener: late }).ok,
      true
    );
  });

  it("is closed to the manager at night, at both ends", () => {
    // The studio asked for the night to be those two and nobody else.
    const toManager = walkiePressAllowed({ wallClock: night, speaker: late, target: { kind: "manager" } });
    assert.equal(toManager.ok === false && toManager.reason, "night-listener");

    const fromManager = walkiePressAllowed({
      wallClock: night,
      speaker: anyoneElse,
      target: { kind: "person", id: "x" },
      listener: late,
    });
    assert.equal(fromManager.ok === false && fromManager.reason, "night-speaker");
  });

  it("refuses everybody else at night, at either end", () => {
    const speaking = walkiePressAllowed({ wallClock: night, speaker: anyoneElse, target: { kind: "manager" } });
    assert.equal(speaking.ok === false && speaking.reason, "night-speaker");

    const reaching = walkiePressAllowed({
      wallClock: night,
      speaker: late,
      target: { kind: "person", id: "x" },
      listener: anyoneElse,
    });
    assert.equal(reaching.ok === false && reaching.reason, "night-listener");
  });
});
