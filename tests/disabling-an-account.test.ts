import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// What "disabled" has to mean, in full.
//
// Disabling somebody is three separate things in three tables, and only the
// first is obvious:
//
//   1. `Employee.active` — every session is checked against it, so the portal
//      locks them out on their next request, and every "who is on the team"
//      query drops them.
//   2. `PushSubscription.active` — the browser's channel.
//   3. `DeviceToken.active` — the iOS app's channel.
//
// Until 2026-11-05 only the first two were done. The APNS sender selects on
// `deviceToken.active` and never joins to the employee, so a disabled account
// kept a live token: Amro was switched off on the morning his phone had taken
// thirty clock-in reminders, and his iPhone would have gone on taking them.
//
// This is pinned at the source rather than against rows because the gap was
// invisible every other way — it typechecked, linted, built, and the account
// really was disabled on every screen the manager can see. The one place it
// showed was a phone nobody was holding.

const root = process.cwd();
const read = (...path: string[]) => readFileSync(join(root, ...path), "utf8");
const actions = read("src", "lib", "actions", "admin-employee-actions.ts");

const bodyOf = (name: string) => {
  const start = actions.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const end = actions.indexOf("\n}", start);
  assert.ok(end > start, `${name} has a body`);
  return actions.slice(start, end);
};

describe("disabling an employee account", () => {
  it("retires both push channels, not just the browser's", () => {
    // Not exported — one private helper both doors go through, so there is
    // only ever one list of channels to keep complete.
    const start = actions.indexOf("async function retireDevices(");
    assert.ok(start >= 0, "retireDevices exists");
    const body = actions.slice(start, actions.indexOf("\n}", start));
    assert.match(body, /pushSubscription\.updateMany[\s\S]*?active: false/, "the browser's subscription");
    assert.match(body, /deviceToken\.updateMany[\s\S]*?active: false/, "and the iOS app's token");
  });

  it("locks the session out and retires the devices, in that order", () => {
    const body = bodyOf("setEmployeeActive");
    assert.match(body, /await requireAdmin\(\)/, "the manager's alone");
    assert.match(body, /employee\.update\(\{ where: \{ id \}, data: \{ active \} \}\)/);
    assert.match(body, /if \(!active\) await retireDevices\(id\)/);
  });

  it("leaves the devices alone when somebody is switched back on", () => {
    // A token comes back on its own the moment the app is opened — the
    // registration route re-activates it. Reviving one here would only spend
    // pushes on a phone that may be long gone.
    const body = bodyOf("setEmployeeActive");
    assert.doesNotMatch(body, /active: true/, "nothing here re-activates a device");
    const route = read("src", "app", "api", "mobile", "devices", "route.ts");
    assert.match(route, /upsert\(\{[\s\S]*?active: true/, "the app's own registration brings it back");
  });

  it("revoking an account goes through the same retirement", () => {
    const body = bodyOf("revokeEmployeeAccount");
    assert.match(body, /active: false/, "the account itself");
    assert.match(body, /await retireDevices\(id\)/, "and every device, by the one path");
  });
});
