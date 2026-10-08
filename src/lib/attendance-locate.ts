import net from "node:net";
import { deviceAddress, readSerial, type DeviceAddress } from "@/lib/attendance-device";
import {
  addressToUse,
  chooseDevice,
  cleanSerial,
  maySearch,
  readRemembered,
  subnetHosts,
  type Candidate,
  type Remembered,
} from "@/lib/attendance-find";
import { getSetting, setSetting } from "@/lib/settings";

// Where the fingerprint device is *now*, and looking for it when it has moved.
//
// `ATTENDANCE_DEVICE_IP` says where the device was when somebody typed it in.
// The router decides where it is (see lib/attendance-find.ts for the four days
// that cost), so every caller asks here rather than reading the setting:
// `currentDeviceAddress()` answers with wherever it was last found.
//
// The rules — only the studio's own network, never a stranger, not too often —
// are pure and tested in lib/attendance-find.ts. This file is the sockets and
// the two rows that remember.
//
// Not "use server": nothing here checks who is asking.

/** Where the device was last found: `{ ip, serial, foundAt, configuredIp }`. */
export const DEVICE_AT_KEY = "attendance_device_at";
/** When the network was last searched for it (an ISO moment). */
export const DEVICE_SEARCHED_KEY = "attendance_device_searched_at";

/** How long to wait on each address. A device on the same network answers in a few milliseconds. */
const KNOCK_MS = 1_500;
/** No more than this many machines are asked who they are in one search. */
const ASK_AT_MOST = 6;
/** How long a machine is left alone between being knocked on and being asked. */
const ASK_AFTER_MS = 1_200;

const rest = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function remembered(): Promise<Remembered | null> {
  return readRemembered(await getSetting(DEVICE_AT_KEY));
}

/**
 * The address to talk to the device at, or null when the studio has none.
 *
 * Where it was last found, unless the configured address has been changed
 * since — somebody saying where it is beats what a search found before they
 * said so.
 */
export async function currentDeviceAddress(): Promise<DeviceAddress | null> {
  const configured = deviceAddress();
  if (!configured) return null;
  return { ip: addressToUse(configured.ip, await remembered()), port: configured.port };
}

/** Which of these addresses accept a connection on the device's port. */
function knock(hosts: string[], port: number): Promise<string[]> {
  return Promise.all(
    hosts.map(
      (host) =>
        new Promise<string | null>((resolve) => {
          const socket = net.connect({ host, port });
          const done = (answer: string | null) => {
            socket.destroy();
            resolve(answer);
          };
          socket.setTimeout(KNOCK_MS, () => done(null));
          socket.once("connect", () => done(host));
          socket.once("error", () => done(null));
        })
    )
  ).then((answers) => answers.filter((answer): answer is string => answer !== null));
}

/**
 * Notes which machine this is, the first time it is read — so that a later
 * search has a serial to hold a candidate to. One extra question, asked once.
 * Never throws: knowing the serial is a convenience for another day.
 */
export async function rememberDevice(at: DeviceAddress, now = new Date()): Promise<void> {
  try {
    const configured = deviceAddress();
    if (!configured) return;
    const known = await remembered();
    if (known && known.ip === at.ip && known.serial && known.configuredIp === configured.ip) return;

    const serial = cleanSerial(await readSerial(at));
    if (!serial) return;
    await setSetting(
      DEVICE_AT_KEY,
      JSON.stringify({ ip: at.ip, serial, foundAt: now.toISOString(), configuredIp: configured.ip } satisfies Remembered)
    );
  } catch {
    // The device was read; that it could not also be named changes nothing today.
  }
}

/**
 * Looks for the device on the studio's network after `tried` did not answer.
 *
 * Answers with its new address, remembered for every caller from then on, or
 * null — not found, more than one machine and no serial to tell them apart, or
 * searched too recently to look again. It never throws.
 */
export async function relocateDevice(tried: DeviceAddress, now = new Date()): Promise<DeviceAddress | null> {
  try {
    const configured = deviceAddress();
    if (!configured) return null;

    if (!maySearch(await getSetting(DEVICE_SEARCHED_KEY), now.getTime())) return null;
    await setSetting(DEVICE_SEARCHED_KEY, now.toISOString());

    const known = await remembered();
    // The configured address first — it is the likeliest place for a device
    // somebody has just fixed — then the network it and the last one are on.
    const hosts = [...new Set([configured.ip, ...subnetHosts(configured.ip), ...subnetHosts(tried.ip)])].filter(
      (host) => host !== tried.ip
    );
    const open = await knock(hosts, tried.port);

    // One conversation at a time: the device takes no more, and neither does
    // whatever else happens to be listening on that port.
    const candidates: Candidate[] = [];
    for (const ip of open.slice(0, ASK_AT_MOST)) {
      // A moment first: the knock above has only just let go of the machine,
      // and one asked again at once answers less cleanly than one given a second.
      await rest(ASK_AFTER_MS);
      let serial = cleanSerial(await readSerial({ ip, port: tried.port }).catch(() => null));
      // Asked once more when the answer is not the serial on record: a garbled
      // read must not make the studio's own device a stranger for ten minutes.
      if (known?.serial && serial !== known.serial) {
        await rest(ASK_AFTER_MS);
        serial = cleanSerial(await readSerial({ ip, port: tried.port }).catch(() => null)) ?? serial;
      }
      if (serial) candidates.push({ ip, serial });
    }

    const found = chooseDevice(candidates, known?.serial ?? null);
    if (!found) {
      console.warn(
        `[attendance] the device did not answer at ${tried.ip}; searched ${hosts.length} addresses, ` +
          `${open.length} had the port open, ${candidates.length} answered as a device — none adopted`
      );
      return null;
    }

    await setSetting(
      DEVICE_AT_KEY,
      JSON.stringify({
        ip: found.ip,
        serial: found.serial,
        foundAt: now.toISOString(),
        configuredIp: configured.ip,
      } satisfies Remembered)
    );
    console.warn(`[attendance] the device has moved: it did not answer at ${tried.ip} and was found at ${found.ip}`);
    return { ip: found.ip, port: tried.port };
  } catch (error) {
    console.error("[attendance] looking for the device failed", error instanceof Error ? error.message : error);
    return null;
  }
}
