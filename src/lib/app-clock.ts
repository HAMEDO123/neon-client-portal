import type { Punch } from "@/lib/attendance";
import { Refusal } from "@/lib/refusal";

// Clocking in and out from the app, wherever somebody is, with the place kept.
//
// Asked for on 2026-11-17 for Wael — "بس يبصم من البرنامج يسجل البصمة
// باللوكيشن الي هو موجود فيه" — who spends his days on sites, nowhere near
// the fingerprint device on the studio's wall. A punch made here is a read like
// any read on the device: the attendance sync takes both together, so the day,
// the lateness, the forgotten scan and the clock-out are all decided by the
// same rules in lib/attendance.ts, and nothing about pay knows the difference.
//
// What it adds is the place. A punch without one is refused — the place is the
// whole point of letting somebody clock in from anywhere — and the time is the
// server's, never the phone's, so a phone with its clock set back cannot clock
// anybody in early.
//
// Pure, so the rules are tested. The database side is lib/app-clock-store.ts.

/** How old a position may be when the button is pressed, in minutes. */
export const FIX_MAX_AGE_MINUTES = 2;

/** How far ahead of the server a phone's clock may be before its position is doubted. */
export const FIX_AHEAD_MINUTES = 2;

/** The worst accuracy taken, in metres. Beyond it the "place" says nothing. */
export const MAX_ACCURACY_METRES = 5_000;

/**
 * A second press within this many seconds is the same punch.
 *
 * A button on a phone gets pressed twice — a slow answer, a thumb — and two
 * reads a few seconds apart are harmless to the sums (a departure needs an
 * hour) but read as a mess on the manager's list.
 */
export const DOUBLE_TAP_SECONDS = 60;

export type ClockFix = { latitude: number; longitude: number; accuracy: number };

const MINUTE = 60_000;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * The position a punch is made with, from what the browser or the phone sent:
 * latitude, longitude, accuracy in metres, and when the position was taken.
 *
 * Refused in words — this is read by somebody standing on a site with a phone.
 */
export function readClockFix(
  input: { latitude: unknown; longitude: unknown; accuracy: unknown; fixedAt: unknown },
  now: Date = new Date()
): ClockFix {
  const latitude = finite(input.latitude);
  const longitude = finite(input.longitude);
  if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Refusal("Your location didn't come through. Turn location on for NEON and try again.");
  }
  // Exactly 0,0 is what a broken fix reads as, not a place anybody works.
  if (latitude === 0 && longitude === 0) {
    throw new Refusal("Your location didn't come through. Turn location on for NEON and try again.");
  }

  const accuracy = finite(input.accuracy);
  if (accuracy === null || accuracy < 0) {
    throw new Refusal("Your location didn't come through. Turn location on for NEON and try again.");
  }
  if (accuracy > MAX_ACCURACY_METRES) {
    throw new Refusal(
      "Your phone only knows roughly where you are. Turn on precise location for NEON, step outside if you can, and try again."
    );
  }

  const fixedAt = typeof input.fixedAt === "string" && ISO_INSTANT.test(input.fixedAt) ? new Date(input.fixedAt) : null;
  if (!fixedAt || Number.isNaN(fixedAt.getTime())) {
    throw new Refusal("Your location didn't come through. Turn location on for NEON and try again.");
  }
  const ahead = fixedAt.getTime() - now.getTime();
  if (ahead > FIX_AHEAD_MINUTES * MINUTE) {
    throw new Refusal("Your phone's clock is ahead. Set its date and time to automatic and try again.");
  }
  if (-ahead > FIX_MAX_AGE_MINUTES * MINUTE) {
    throw new Refusal("That location is old. Try again so it's taken where you are now.");
  }

  return { latitude, longitude, accuracy };
}

/**
 * Whether a press is the same punch as the one just made — see
 * DOUBLE_TAP_SECONDS.
 */
export function isDoubleTap(last: Date | null | undefined, now: Date): boolean {
  if (!last) return false;
  const seconds = (now.getTime() - last.getTime()) / 1000;
  return seconds >= 0 && seconds < DOUBLE_TAP_SECONDS;
}

/**
 * Where a person's app punches are filed in the sync when the device has no
 * number for them. Somebody with a number has their app punches filed under
 * it, beside the device's own reads, so the two make one day.
 */
export function appPunchKey(employeeId: string): string {
  return `app:${employeeId}`;
}

/** App punches as the sync reads punches, under the person's device number when they have one. */
export function asPunches(
  rows: { employeeId: string; at: Date }[],
  deviceUserIdOf: (employeeId: string) => string | null | undefined
): Punch[] {
  return rows.map((row) => ({
    deviceUserId: deviceUserIdOf(row.employeeId) ?? appPunchKey(row.employeeId),
    at: row.at,
    fromApp: true,
  }));
}

/**
 * The reads a day already holds, as punches, for writing an app punch when the
 * device itself cannot be asked.
 *
 * The row's arrival and departure are real reads when the device wrote them,
 * so they go in beside the app's and the day comes out the same as a full sync
 * would make it — a clock-out from a site does not lose the morning's scan at
 * the door. On a row whose arrival the manager set (ARRIVAL) only the
 * departure is a read; on the manager's own row (MANUAL) neither is, and the
 * store leaves their figures alone anyway.
 */
export function recordedPunches(
  row: { source: string; arrivedAt: Date | null; departedAt: Date | null } | null,
  key: string
): Punch[] {
  if (!row) return [];
  const reads: Date[] = [];
  if (row.source === "DEVICE" && row.arrivedAt) reads.push(row.arrivedAt);
  if ((row.source === "DEVICE" || row.source === "ARRIVAL") && row.departedAt) reads.push(row.departedAt);
  return reads.map((at) => ({ deviceUserId: key, at }));
}

/**
 * Where somebody may clock in and out from the app — the owner, 2026-11-21:
 * "for wael clock in outside the office he should around this coordinates
 * 31.977115, 35.866423". Kept in AppSetting `app_clock_places` as JSON of
 * employee id → { latitude, longitude, radiusMetres }; somebody without an
 * entry may clock in from anywhere, as before. The fingerprint at the studio
 * is untouched by it.
 */
export const APP_CLOCK_PLACES = "app_clock_places";

/** How near "around" is, when an entry names no radius. */
export const DEFAULT_PLACE_RADIUS_METRES = 300;

/**
 * The most a position's own uncertainty is allowed to help. A phone that
 * knows only "within 3 km" cannot show it is within 300 m of anywhere.
 */
export const PLACE_ACCURACY_ALLOWANCE_METRES = 100;

export type ClockPlace = { latitude: number; longitude: number; radiusMetres: number };

/** The saved places, each checked; anything unreadable is left out. */
export function readClockPlaces(raw: string | null | undefined): Record<string, ClockPlace> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const places: Record<string, ClockPlace> = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const latitude = finite(entry.latitude);
    const longitude = finite(entry.longitude);
    if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    const radius = finite(entry.radiusMetres);
    places[id] = { latitude, longitude, radiusMetres: radius && radius > 0 ? radius : DEFAULT_PLACE_RADIUS_METRES };
  }
  return places;
}

/** Metres between two points on the Earth (haversine). */
export function distanceMetres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6_371_000;
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Refuses a punch made away from the person's place, in words. Within the
 * radius, plus as much of the position's uncertainty as is fair to allow.
 */
export function checkClockPlace(fix: ClockFix, place: ClockPlace | null | undefined) {
  if (!place) return;
  const away = distanceMetres(fix, place);
  const allowed = place.radiusMetres + Math.min(Math.max(0, fix.accuracy), PLACE_ACCURACY_ALLOWANCE_METRES);
  if (away <= allowed) return;
  const said = away >= 1000 ? `${(away / 1000).toFixed(1)} km` : `${Math.round(away / 10) * 10} m`;
  throw new Refusal(
    `You're ${said} from where you clock in from the app. Clock in there, or on the fingerprint at the studio.`
  );
}

/** A link that opens the place on a map, on any phone or computer. */
export function mapLink(place: { latitude: number; longitude: number }): string {
  return `https://www.google.com/maps?q=${place.latitude.toFixed(6)},${place.longitude.toFixed(6)}`;
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}
