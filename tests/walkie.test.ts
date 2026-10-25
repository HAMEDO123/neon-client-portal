import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readWalkieSeconds, readWalkieTarget, walkieHoursOpen, walkiePayload, WALKIE_MAX_SECONDS } from "@/lib/walkie";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

describe("the walkie-talkie", () => {
  it("wakes the phone with everything it needs to play", () => {
    const payload = walkiePayload({ id: "w1", audioUrl: "https://x/a.m4a", seconds: 4, fromName: "Hamed" });
    assert.equal(payload.activeSpeaker, "Hamed");
    assert.deepEqual(payload.neon, { kind: "walkie", id: "w1", audioUrl: "https://x/a.m4a", seconds: 4, from: "Hamed" });
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

  // 10:00 until 04:00 the next morning — across midnight, so both sides of it.
  it("is open from ten in the morning until four the next morning", () => {
    assert.equal(walkieHoursOpen("09:59"), false);
    assert.equal(walkieHoursOpen("10:00"), true);
    assert.equal(walkieHoursOpen("15:30"), true);
    assert.equal(walkieHoursOpen("23:59"), true);
    assert.equal(walkieHoursOpen("00:00"), true);
    assert.equal(walkieHoursOpen("03:59"), true);
    assert.equal(walkieHoursOpen("04:00"), false);
    assert.equal(walkieHoursOpen("06:00"), false);
  });

  // The studio's rule, checked before anything is stored.
  it("speaks only inside its hours", () => {
    const store = read("src", "lib", "walkie-store.ts");
    assert.match(store, /if \(!\(await walkieOpen\(\)\)\) return \{ ok: false, reason: "closed" \};/);
  });

  // Only a phone whose owner turned it on has a PTT token, and only those are
  // sent to: a send that went by anything else would reach a phone nobody agreed to.
  it("is sent only to the phones whose owner turned it on", () => {
    const store = read("src", "lib", "walkie-store.ts");
    assert.match(store, /deviceTokens: \{ where: \{ active: true, kind: "PTT" \} \}/);
    assert.match(store, /sendPushToTalk\(/);
  });

  it("is anybody's in the studio to use, and nobody's else", () => {
    const registry = read("src", "lib", "mobile", "registry", "walkie.ts");
    assert.match(registry, /"walkie\/send": guardedAction\(requireStaff/);
    assert.match(registry, /"walkie\/leave": guardedAction\(requireStaff/);
  });
});
