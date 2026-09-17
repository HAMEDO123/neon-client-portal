import ZKLib, { type ZKAttendance, type ZKUser } from "zkteco-js";
import type { Punch } from "@/lib/attendance";

// Talking to the fingerprint machine on the studio's wall.
//
// Everything that decides anything lives elsewhere: lib/attendance.ts turns
// punches into hours and lib/attendance-store.ts writes them. This file only
// opens a socket, asks, and closes — so the rules stay testable without a
// device, and a device that is unplugged can only ever make a sync say nothing
// happened.
//
// Not "use server": every export of one of those is callable over the network,
// and nothing here checks who is asking.

/** How long to wait on the machine before giving up on it. */
const TIMEOUT_MS = 10_000;
/** The local UDP port the library replies on. */
const REPLY_PORT = 4000;
const DEFAULT_PORT = 4370;

export type DeviceAddress = { ip: string; port: number };

/**
 * Where the device is, or null when the studio has not said.
 *
 * Absent configuration switches the feature off rather than failing: the same
 * shape as ANTHROPIC_API_KEY and the R2 variables elsewhere here, so a machine
 * that has no device — a developer's laptop, a fresh install — simply never
 * syncs instead of erroring on every cron pass.
 */
export function deviceAddress(): DeviceAddress | null {
  const ip = process.env.ATTENDANCE_DEVICE_IP?.trim();
  if (!ip) return null;

  const port = Number(process.env.ATTENDANCE_DEVICE_PORT ?? DEFAULT_PORT);
  return { ip, port: Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT };
}

/** The library answers either a bare array or `{ data }`, depending on its transport. */
function rows<T>(answer: T[] | { data: T[] } | null | undefined): T[] {
  if (Array.isArray(answer)) return answer;
  if (answer && Array.isArray((answer as { data: T[] }).data)) return (answer as { data: T[] }).data;
  return [];
}

/**
 * Opens the device, does one thing, and always closes.
 *
 * The close is in a `finally` because the device holds a small number of
 * connections and refuses new ones once they are used up — a sync that threw
 * halfway would otherwise lock everybody out of it until it was power-cycled,
 * including the people trying to clock in.
 */
// The callback is `run` and must never be called `use`: a function by that name
// is React 19's hook as far as react-hooks/rules-of-hooks is concerned, and it
// fails the lint with "React Hook use cannot be called in a try/catch block" —
// in a file that renders nothing and imports no React at all.
async function withDevice<T>(at: DeviceAddress, run: (device: ZKLib) => Promise<T>): Promise<T> {
  const device = new ZKLib(at.ip, at.port, TIMEOUT_MS, REPLY_PORT);
  await device.createSocket();
  try {
    return await run(device);
  } finally {
    try {
      await device.disconnect();
    } catch {
      // Already gone. Nothing useful to do, and it must not mask the real error.
    }
  }
}

export type DeviceUser = {
  /** The number the attendance logs refer to — what Employee.deviceUserId holds. */
  deviceUserId: string;
  name: string;
  /** The device's own administrator, who is the manager rather than a member of staff. */
  isAdmin: boolean;
};

/** Who is enrolled on the machine, for the screen that pairs them with employees. */
export async function readDeviceUsers(at: DeviceAddress): Promise<DeviceUser[]> {
  return withDevice(at, async (device) => {
    const found = rows<ZKUser>(await device.getUsers());
    return found
      .map((user) => ({
        deviceUserId: String(user.userId ?? user.uid),
        name: (user.name ?? "").trim(),
        isAdmin: user.role === 14,
      }))
      .filter((user) => user.deviceUserId !== "");
  });
}

/**
 * Every read the device still holds, as punches.
 *
 * It keeps its own log — 50,000 of them on the machine here — and hands over
 * all of them every time, so a sync is naturally idempotent: the same days come
 * back, land on the same `(employee, day)` rows, and overwrite themselves with
 * the same numbers. Nothing here deletes from the device, which means a failed
 * sync loses nothing and can simply be run again.
 */
export async function readPunches(at: DeviceAddress): Promise<Punch[]> {
  return withDevice(at, async (device) => {
    const found = rows<ZKAttendance>(await device.getAttendances());

    return found
      .map((row) => ({ deviceUserId: String(row.user_id), at: new Date(row.record_time) }))
      .filter((punch) => punch.deviceUserId !== "" && !Number.isNaN(punch.at.getTime()));
  });
}

export type DeviceClock = { deviceTime: Date; driftSeconds: number };

/**
 * What the machine thinks the time is, and how far out it is.
 *
 * Worth surfacing rather than assuming: this device was found set to November
 * 2000 with a nine-month hole in its log, which is what a dead backup battery
 * looks like. A clock that has drifted files today's arrivals under a day
 * nobody will look at, and the lateness they carry is meaningless.
 */
export async function readClock(at: DeviceAddress, now = new Date()): Promise<DeviceClock> {
  return withDevice(at, async (device) => {
    const deviceTime = new Date(await device.getTime());
    return {
      deviceTime,
      driftSeconds: Math.round((deviceTime.getTime() - now.getTime()) / 1000),
    };
  });
}

/** Puts the machine's clock right. */
export async function setClock(at: DeviceAddress, now = new Date()): Promise<DeviceClock> {
  return withDevice(at, async (device) => {
    await device.setTime(now);
    const deviceTime = new Date(await device.getTime());
    return {
      deviceTime,
      driftSeconds: Math.round((deviceTime.getTime() - now.getTime()) / 1000),
    };
  });
}
