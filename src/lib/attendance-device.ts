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
  if (!wall) return null;

  const minute = instantAt(wall.dayKey, wall.time, timeZone);
  // instantAt speaks HH:MM, so the seconds are added back rather than lost:
  // without this a correct clock reports as up to 59 seconds slow.
  return minute ? new Date(minute.getTime() + wall.seconds * 1000) : null;
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
  /**
   * The device's internal slot number.
   *
   * Carried because **deleteUser takes this, not the userid** — they are
   * different numbers and often differ. Deleting by the wrong one removes
   * somebody else.
   */
  uid: number;
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
        uid: Number(user.uid),
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
  const instant = instantOf(reported, timeZone);

  return {
    deviceTime: instant ?? new Date(NaN),
    wallClock: wall
      ? `${wall.dayKey} ${wall.time}:${String(wall.seconds).padStart(2, "0")}`
      : "unreadable",
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
 * Runs a write with the machine disabled, and always re-enables it.
 *
 * The ZK protocol wants writes done while the device is not serving. Leaving it
 * disabled would stop people clocking in — a worse fault than the one being
 * fixed — so the re-enable is in a `finally` and never swallowed by an earlier
 * failure.
 */
async function whileDisabled<T>(device: ZKLib, write: () => Promise<T>): Promise<T> {
  try {
    await device.disableDevice();
  } catch {
    // Not every firmware requires it; the write itself is what matters.
  }
  try {
    return await write();
  } finally {
    try {
      await device.enableDevice();
    } catch {
      // Nothing useful to do, and it must not mask the real error.
    }
  }
}

export type NewDeviceUser = {
  /** The number attendance logs will refer to — what gets paired to an employee. */
  deviceUserId: string;
  name: string;
};

/**
 * Creates a person on the device.
 *
 * **This makes the record, not the fingerprint.** A finger can only be enrolled
 * at the machine itself, by the person putting it on the reader — nothing over
 * the network can do it. So this is half of adding somebody, and any screen
 * offering it has to say so, or a manager walks away believing a person is set
 * up when the device will never recognise them.
 *
 * The slot number is chosen here rather than asked for: it is the device's own
 * bookkeeping, it must not collide, and nobody should have to know it exists.
 */
export async function createDeviceUser(at: DeviceAddress, user: NewDeviceUser): Promise<{ uid: number }> {
  const name = user.name.trim().slice(0, 24);
  const deviceUserId = user.deviceUserId.trim();
  if (!deviceUserId) throw new Error("Give the person a number.");
  if (!name) throw new Error("Give the person a name.");

  return withDevice(at, async (device) => {
    const existing = rows<ZKUser>(await device.getUsers());

    // Refused rather than overwritten: setUser on a number somebody already has
    // replaces them, and the first sign would be their attendance appearing
    // under the wrong name.
    if (existing.some((row) => String(row.userId ?? row.uid) === deviceUserId)) {
      throw new Error(`Number ${deviceUserId} is already used on the device.`);
    }

    const uid = existing.reduce((highest, row) => Math.max(highest, Number(row.uid) || 0), 0) + 1;
    await whileDisabled(device, () => device.setUser(uid, deviceUserId, name, "", 0, 0));
    return { uid };
  });
}

/**
 * Removes somebody from the device, by its internal slot number.
 *
 * Takes `uid` because that is what the protocol takes — the number shown to
 * people, and stored against an employee, is `userId`, and they are not the
 * same. Callers must pass the uid from readDeviceUsers rather than the paired
 * number, or this deletes a different person.
 *
 * Their past punches stay in the device's log; only the person is removed.
 */
export async function removeDeviceUser(at: DeviceAddress, uid: number): Promise<void> {
  if (!Number.isInteger(uid) || uid < 0) throw new Error("That is not a slot on the device.");

  await withDevice(at, async (device) => {
    await whileDisabled(device, () => device.deleteUser(uid));
  });
}

/**
 * Wipes the device's attendance log.
 *
 * **Irreversible, and it destroys history that was never imported.** A sync only
 * records days on or after its cutoff — today, by default — so everything older
 * lives nowhere but the machine. Clearing it is how two years of arrivals stop
 * existing. Nothing calls this without a person deliberately asking for it.
 */
export async function clearDeviceLog(at: DeviceAddress): Promise<void> {
  await withDevice(at, async (device) => {
    await whileDisabled(device, () => device.clearAttendanceLog());
  });
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
