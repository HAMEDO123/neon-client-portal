// Finding the fingerprint device again when its address changes.
//
// The device takes its address from the router (DHCP — switched on the day it
// was first found, because its factory address was on another network). So the
// router may hand it a different one after a power cut, and on 2026-10-04 it
// did: `.210` became `.188`, the platform went on asking `.210`, and for four
// days nothing was recorded, nobody was reminded to clock in, and nothing said
// so. The device itself was fine — a healthy machine on a wall, one number away
// from where it was being looked for.
//
// So when it stops answering, the platform looks for it. This file is the
// rules for that, pure and tested, because each one fails in a way that costs
// somebody money or reaches outside the studio:
//
//   - **Only the studio's own network is ever searched.** The addresses come
//     from the one the device was configured at, and only if that is a private
//     address — a typo must not turn into a port scan of somebody else's range.
//   - **A stranger is never adopted.** Once the device's serial number is
//     known, only that serial is accepted. Attendance from the wrong machine
//     is lateness charged to the wrong people.
//   - **Not too often.** An unplugged device would otherwise be searched for
//     every minute, by the pass that runs every minute.
//   - **Silence is said, once a day.** Finding it is the cure; telling the
//     manager is for the day there is nothing to find.

/** The private ranges a studio's network can be on. */
export function isPrivateV4(ip: string): boolean {
  const parts = ip.trim().split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/**
 * Every other address on the same /24 as `ip` — where a device that moved has
 * moved to. Empty for anything that is not a private address.
 */
export function subnetHosts(ip: string): string[] {
  if (!isPrivateV4(ip)) return [];
  const [a, b, c, own] = ip.trim().split(".").map(Number);
  const hosts: string[] = [];
  for (let last = 1; last <= 254; last++) {
    if (last !== own) hosts.push(`${a}.${b}.${c}.${last}`);
  }
  return hosts;
}

/** How often the network may be searched while the device is silent. */
export const SEARCH_EVERY_MS = 10 * 60_000;

/** Whether enough time has passed since the last search to look again. */
export function maySearch(lastSearchedAt: string | null | undefined, now: number): boolean {
  if (!lastSearchedAt) return true;
  const last = new Date(lastSearchedAt).getTime();
  return Number.isNaN(last) || now - last >= SEARCH_EVERY_MS;
}

/**
 * A serial number as the device reports it, without what it arrives wrapped in.
 *
 * Letters and digits only. The library cuts the serial out of the machine's
 * answer at a fixed place, and what is left around it varies from one read to
 * the next: the same device answered `CQE7232560015`, then `CQE7232560015=` a
 * moment later, with NULs after either. Compared as they came, the device was
 * a stranger to itself and the search adopted nothing — found on the first
 * live run of this, which is the only reason it is known.
 */
export function cleanSerial(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const serial = raw.replace(/^~?SerialNumber=/i, "").replace(/[^A-Za-z0-9]/g, "");
  return serial.length >= 4 ? serial : null;
}

export type Candidate = { ip: string; serial: string };

/**
 * Which of the machines answering on the network is the studio's device.
 *
 * With a serial on record: that one, or nobody. Without one — the very first
 * time — only when exactly one machine answered, since a studio with one
 * device on its wall has one to find; two is a question for a person.
 */
export function chooseDevice(candidates: Candidate[], knownSerial: string | null): Candidate | null {
  if (knownSerial) return candidates.find((candidate) => candidate.serial === knownSerial) ?? null;
  return candidates.length === 1 ? candidates[0] : null;
}

/** Where the device was last found, and what the configured address was then. */
export type Remembered = { ip: string; serial: string | null; foundAt: string; configuredIp: string };

/** Reads the stored record back. Anything unreadable is "nothing remembered". */
export function readRemembered(raw: string | null | undefined): Remembered | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Remembered> | null;
    if (!value || typeof value.ip !== "string" || !isPrivateV4(value.ip)) return null;
    return {
      ip: value.ip.trim(),
      serial: cleanSerial(value.serial),
      foundAt: typeof value.foundAt === "string" ? value.foundAt : "",
      configuredIp: typeof value.configuredIp === "string" ? value.configuredIp : "",
    };
  } catch {
    return null;
  }
}

/**
 * The address to ask: where the device was last found, unless the configured
 * address has been changed since.
 *
 * A changed setting is somebody saying where the device is — a new machine, a
 * fixed address — and that beats what was found by searching before they said
 * it. Left alone, the setting is only where the device once was.
 */
export function addressToUse(configuredIp: string, remembered: Remembered | null): string {
  if (!remembered || remembered.configuredIp !== configuredIp) return configuredIp;
  return remembered.ip;
}

/** How long the device may go unread, in working hours, before the manager is told. */
export const SILENT_AFTER_MINUTES = 30;

/**
 * Whether to tell the manager the device has gone quiet.
 *
 * Only while the studio is open — a device nobody is using at midnight is
 * nobody's emergency — and only once it has been long enough to be a fault
 * rather than a moment. `lastReadAt` null is a device never read at all, which
 * is as silent as it gets.
 */
export function deviceIsSilent(input: { lastReadAt: Date | null; now: Date; working: boolean }): boolean {
  if (!input.working) return false;
  if (!input.lastReadAt) return true;
  return (input.now.getTime() - input.lastReadAt.getTime()) / 60_000 >= SILENT_AFTER_MINUTES;
}

/** One telling a day: the key carries the day, never the clock. */
export function silentKey(dayKey: string): string {
  return `ATTENDANCE_DEVICE_SILENT:${dayKey}`;
}

/** What the manager is told, in words about what NEON can see — never about anybody. */
export function silentCopy(lastReadAt: Date | null, timeZone: string): { title: string; message: string } {
  const since = lastReadAt
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone,
        weekday: "long",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(lastReadAt)
    : null;
  return {
    title: "The fingerprint device is not answering",
    message:
      `NEON ${since ? `has not been able to read it since ${since}` : "has never been able to read it"}. ` +
      "Nothing is being recorded and nobody is being reminded to clock in. " +
      "Check that it is switched on and plugged into the network — NEON looks for it by itself and picks it up again when it is.",
  };
}
