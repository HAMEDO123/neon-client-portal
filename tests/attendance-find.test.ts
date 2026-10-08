import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SEARCH_EVERY_MS,
  SILENT_AFTER_MINUTES,
  addressToUse,
  chooseDevice,
  cleanSerial,
  deviceIsSilent,
  isPrivateV4,
  maySearch,
  readRemembered,
  silentCopy,
  silentKey,
  subnetHosts,
} from "../src/lib/attendance-find";

// Finding the fingerprint device again when the router gives it a new address.
// On 2026-10-04 it moved from .210 to .188 and nothing was recorded for four
// days. Each rule here fails in a way that either costs somebody money or
// reaches outside the studio, so each is pinned.

const NOW = Date.parse("2026-10-08T08:00:00Z");

describe("where it may be looked for", () => {
  it("is the rest of the studio's own network", () => {
    const hosts = subnetHosts("192.168.100.210");
    assert.equal(hosts.length, 253);
    assert.ok(hosts.includes("192.168.100.188"));
    assert.ok(hosts.includes("192.168.100.1") && hosts.includes("192.168.100.254"));
    // Not itself: that is the address that just did not answer.
    assert.equal(hosts.includes("192.168.100.210"), false);
    assert.ok(hosts.every((host) => host.startsWith("192.168.100.")));
  });

  // A mistyped setting must not become a port scan of somebody else's range.
  it("is nowhere at all for an address that is not a private one", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "193.168.1.1", "clients.neonjo.com", "", "192.168.1", "192.168.1.999"]) {
      assert.deepEqual(subnetHosts(ip), [], ip);
      assert.equal(isPrivateV4(ip), false, ip);
    }
    for (const ip of ["10.0.0.5", "172.16.4.1", "172.31.255.2", "192.168.100.137"]) {
      assert.equal(isPrivateV4(ip), true, ip);
    }
  });
});

describe("which machine is adopted", () => {
  const ours = { ip: "192.168.100.188", serial: "CQE7232560015" };
  const another = { ip: "192.168.100.90", serial: "ZZZ0000000001" };

  // Attendance read from the wrong machine is lateness charged to the wrong people.
  it("is only the one whose serial is on record", () => {
    assert.deepEqual(chooseDevice([another, ours], "CQE7232560015"), ours);
    assert.equal(chooseDevice([another], "CQE7232560015"), null);
    assert.equal(chooseDevice([], "CQE7232560015"), null);
  });

  it("is the only one answering, the first time, and nobody when there are two", () => {
    assert.deepEqual(chooseDevice([ours], null), ours);
    assert.equal(chooseDevice([ours, another], null), null);
    assert.equal(chooseDevice([], null), null);
  });

  it("reads a serial without the padding it arrives in", () => {
    assert.equal(cleanSerial("CQE7232560015\u0000\u0000"), "CQE7232560015");
    assert.equal(cleanSerial("  CQE7232560015\n"), "CQE7232560015");
    assert.equal(cleanSerial("\u0000"), null);
    assert.equal(cleanSerial(undefined), null);
    assert.equal(cleanSerial(42), null);
  });
});

describe("the address that is asked", () => {
  const found = { ip: "192.168.100.188", serial: "CQE7232560015", foundAt: "2026-10-08T08:00:00Z", configuredIp: "192.168.100.210" };

  it("is where the device was last found", () => {
    assert.equal(addressToUse("192.168.100.210", found), "192.168.100.188");
  });

  // A changed setting is somebody saying where it is: a new machine, a fixed
  // address. That beats what a search found before they said so.
  it("is the configured one again once somebody changes the setting", () => {
    assert.equal(addressToUse("192.168.100.50", found), "192.168.100.50");
  });

  it("is the configured one when nothing was ever found", () => {
    assert.equal(addressToUse("192.168.100.210", null), "192.168.100.210");
  });

  it("is remembered across a restart, and anything unreadable is nothing", () => {
    assert.deepEqual(readRemembered(JSON.stringify(found)), found);
    assert.equal(readRemembered("{"), null);
    assert.equal(readRemembered(null), null);
    // An address that is not on a private network is never trusted back.
    assert.equal(readRemembered(JSON.stringify({ ...found, ip: "8.8.8.8" })), null);
  });
});

describe("how often it is looked for", () => {
  // The pass that reads the device runs every minute; an unplugged device must
  // not be searched for sixty times an hour.
  it("is once, then not again until the gap has passed", () => {
    assert.equal(maySearch(null, NOW), true);
    assert.equal(maySearch(new Date(NOW - 60_000).toISOString(), NOW), false);
    assert.equal(maySearch(new Date(NOW - SEARCH_EVERY_MS).toISOString(), NOW), true);
    assert.equal(maySearch("not a date", NOW), true);
  });
});

describe("telling the manager it has gone quiet", () => {
  const now = new Date(NOW);
  const minutesAgo = (m: number) => new Date(NOW - m * 60_000);

  it("is for a silence long enough to be a fault, in working hours", () => {
    assert.equal(deviceIsSilent({ lastReadAt: minutesAgo(SILENT_AFTER_MINUTES), now, working: true }), true);
    assert.equal(deviceIsSilent({ lastReadAt: minutesAgo(5), now, working: true }), false);
    // Never read at all is as silent as it gets.
    assert.equal(deviceIsSilent({ lastReadAt: null, now, working: true }), true);
  });

  // A device nobody is using at midnight is nobody's emergency.
  it("is never said outside working hours", () => {
    assert.equal(deviceIsSilent({ lastReadAt: minutesAgo(600), now, working: false }), false);
    assert.equal(deviceIsSilent({ lastReadAt: null, now, working: false }), false);
  });

  it("is said once a day, and about the device rather than about anybody", () => {
    assert.equal(silentKey("2026-10-08"), "ATTENDANCE_DEVICE_SILENT:2026-10-08");
    const copy = silentCopy(new Date("2026-10-04T11:21:00Z"), "Asia/Amman");
    assert.equal(copy.title, "The fingerprint device is not answering");
    // In the studio's own clock: 11:21 UTC is 14:21 in Amman.
    assert.match(copy.message, /Sunday,? 4 Oct/);
    assert.match(copy.message, /14:21/);
    assert.equal(/absent|late|did not come|missing/i.test(copy.message), false);
    assert.match(silentCopy(null, "Asia/Amman").message, /has never been able to read it/);
  });
});

// A search nobody calls finds nothing, and a caller still reading the setting
// goes on asking an address the device left — exactly the fault this exists
// for. So the wiring is pinned as well as the rules.
describe("everything asks where the device is now", () => {
  const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");

  it("and nothing but the locator reads the configured address", () => {
    for (const file of [
      ["src", "lib", "attendance-sync.ts"],
      ["src", "lib", "actions", "operations-actions.ts"],
      ["src", "lib", "mobile", "ops-attendance.ts"],
      ["src", "app", "admin", "(dashboard)", "attendance", "page.tsx"],
    ]) {
      const source = read(...file);
      assert.equal(/\bdeviceAddress\(\)/.test(source), false, `${file.at(-1)} reads the configured address itself`);
      assert.match(source, /currentDeviceAddress\(\)/, file.at(-1));
    }
  });

  it("the sync looks for it when it does not answer, and the pass says so when it is not found", () => {
    assert.match(read("src", "lib", "attendance-sync.ts"), /relocateDevice\(at, now\)/);
    assert.match(read("src", "app", "api", "cron", "notifications", "route.ts"), /tellIfDeviceSilent\(report\)/);
  });
});
