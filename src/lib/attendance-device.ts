import ZKLib, { type ZKAttendance, type ZKUser } from "zkteco-js";
import { deviceWallClock, type Punch } from "@/lib/attendance";
import { dayKeyIn, instantAt, wallClockIn } from "@/lib/time";

// Talking to the fingerprint machine on the studio's wall.
//
// Everything that decides anything lives elsewhere: lib/attendance.ts turns
// punches into hours and lib/attendance-store.ts writes them. This file only
// opens a socket, asks, and closes — so the rules stay testable without a
// device, and a device that is unplugged can only ever make a sync say nothing
// happened.
//
// **Every time this file handles a moment, it goes through the company's
// timezone.** The library builds its Dates from the numbers the machine sends,
// interpreted in whatever timezone the process happens to run in — Amman on a
// laptop, UTC in the container. Treating those as instants put the whole
// feature three hours out in production while it looked perfect in development,
// and would have charged everybody three hours of lateness a day.
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
 * A moment the device reported, as the instant it actually happened.
 *
 * The device knows only wall clock. Which instant that was is a question about
 * the studio's timezone, and is answered in exactly one place: here.
 */
function instantOf(reported: Date | string, timeZone: string): Date | null {
  const wall = deviceWallClock(reported);
  return wall ? instantAt(wall.dayKey, wall.time, timeZone) : null;
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
 * Every read the device still holds, as punches at the instants they happened.
 *
 * It keeps its own log — 50,000 of them on the machine here — and hands over
 * all of them every time, so a sync is naturally idempotent: the same days come
 * back, land on the same `(employee, day)` rows, and overwrite themselves with
 * the same numbers. Nothing here deletes from the device, which means a failed
 * sync loses nothing and can simply be run again.
 */
export async function readPunches(at: DeviceAddress, timeZone: string): Promise<Punch[]> {
  return withDevice(at, async (device) => {
    const found = rows<ZKAttendance>(await device.getAttendances());

    return found.flatMap((row) => {
      const when = instantOf(row.record_time, timeZone);
      const deviceUserId = String(row.user_id ?? "");
      // A read with no usable time is dropped rather than placed somewhere it
      // might not belong — a punch on the wrong day is a deduction on the wrong day.
      return when && deviceUserId !== "" ? [{ deviceUserId, at: when }] : [];
    });
  });
}

export type DeviceClock = {
  /** What the machine displays, as the instant that is in the studio's timezone. */
  deviceTime: Date;
  /** What it displays, as it displays it. */
  wallClock: string;
  driftSeconds: number;
};

function clockFrom(reported: Date | string, timeZone: string, now: Date): DeviceClock {
  const wall = deviceWallClock(reported);
  const instant = wall ? instantAt(wall.dayKey, wall.time, timeZone) : null;

  return {
    deviceTime: instant ?? new Date(NaN),
    wallClock: wall ? `${wall.dayKey} ${wall.time}` : "unreadable",
    // Unreadable counts as badly wrong rather than as agreement: a clock nobody
    // can read must never pass a drift check by default.
    driftSeconds: instant ? Math.round((instant.getTime() - now.getTime()) / 1000) : Number.MAX_SAFE_INTEGER,
  };
}

/**
 * What the machine thinks the time is, and how far out it is.
 *
 * Worth surfacing rather than assuming: this device was found set to November
 * 2000 with a nine-month hole in its log, which is what a dead backup battery
 * looks like. A clock that has drifted files today's arrivals under a day
 * nobody will look at, and the lateness they carry is meaningless.
 */
export async function readClock(at: DeviceAddress, timeZone: string, now = new Date()): Promise<DeviceClock> {
  return withDevice(at, async (device) => clockFrom(await device.getTime(), timeZone, now));
}

/**
 * Puts the machine's clock right.
 *
 * The Date handed to the library is built from the studio's wall clock rather
 * than passed straight through, because the library encodes whatever local
 * components it is given: sending a real instant from a UTC container would set
 * this device, in Amman, three hours slow.
 */
export async function setClock(at: DeviceAddress, timeZone: string, now = new Date()): Promise<DeviceClock> {
  const dayKey = dayKeyIn(timeZone, now);
  const [year, month, day] = dayKey.split("-").map(Number);
  const [hour, minute] = wallClockIn(timeZone, now).split(":").map(Number);
  const asTheDeviceShouldShowIt = new Date(year, month - 1, day, hour, minute, 0);

  return withDevice(at, async (device) => {
    // Disabled first: the machine accepts a write to its clock and ignores it
    // while it is serving.
    try {
      await device.disableDevice();
    } catch {
      // Not every firmware needs it; the write below is the thing that matters.
    }

    await device.setTime(asTheDeviceShouldShowIt);

    try {
      await device.enableDevice();
    } catch {
      // Leaving it disabled would stop people clocking in, so this is reported
      // by the read-back below rather than swallowed silently.
    }

    return clockFrom(await device.getTime(), timeZone, now);
  });
}
