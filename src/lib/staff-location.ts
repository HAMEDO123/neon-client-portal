import { bool, RpcError } from "@/lib/mobile/rpc";
import { isWorkingDay, type WorkHours } from "@/lib/work-hours";
import { dayKeyIn, instantAt, shiftDayKey } from "@/lib/time";

// Where the team is, for the manager's map — what a phone may share, when,
// and what the manager is shown of it. Pure, so the privacy rules are pinned
// by tests rather than by hope; lib/mobile/location-service.ts does the
// reading and the writing, lib/notifications/location-keeper.ts the waking
// and the wiping.
//
// What the studio asked for: a map of where each person is, live, during
// working hours. What comes with it, and is part of the feature rather than a
// setting anybody can turn off:
// - a position is accepted and shown only inside today's working window — the
//   hours and days in Settings, the same ones the clock reminders hang off;
// - only the latest position is kept, never a trail, and the coordinates are
//   wiped as soon as the window closes;
// - somebody the fingerprint device has seen clock out is no longer shared;
// - the manager's own row is never on the map: it is the team, the same
//   people the team count on `team/employees` counts.
//
// The states say what the phone or the device reported, never what somebody
// is doing. A phone that has sent nothing is "waiting": a flat battery, a
// phone left at home and a person who is not in all look the same from here,
// and the map must not choose for the manager which one it was.

const MINUTE = 60_000;

/** A position this fresh is "live"; up to RECENT_MINUTES it is "recent"; older, "stale". */
export const LIVE_MINUTES = 5;
export const RECENT_MINUTES = 20;

/** A report older than this says where somebody was, not where they are, and is refused. */
export const OLDEST_REPORT_MINUTES = 15;
/** How far ahead of the server a phone's clock may run before its time is not believed. */
export const AHEAD_REPORT_MINUTES = 2;
/** iOS answers with an accuracy in metres; past this it is not a position worth keeping. */
export const MAX_ACCURACY_METRES = 50_000;

/** Within this of the office counts as at the office... */
export const OFFICE_RADIUS_METRES = 150;
/** ...after taking off the fix's own accuracy, but never more than this of it. */
export const ACCURACY_ALLOWANCE_METRES = 100;

/** The manager's Refresh asks a phone again after two minutes of quiet. */
export const REFRESH_MINUTES = 2;
/** The scheduler asks after ten — which is also how the day starts, when nobody has a position yet. */
export const KEEPER_MINUTES = 10;

/** What a silent push asking for a position carries beside `aps` (lib/notifications/apns.ts `sendBackground`). */
export const LOCATION_WAKE = { neon: { kind: "location" } } as const;

/** What iOS says about the app's location permission, as the phone reports it. */
export const PERMISSIONS = ["always", "when-in-use", "denied", "restricted", "not-determined"] as const;
export type Permission = (typeof PERMISSIONS)[number] | "unknown";

export type LocationWindow = { start: Date; end: Date };

export type ShareReason = "before-hours" | "after-hours" | "day-off" | "clocked-out";

/** What one phone should be doing now — `me/location`, word for word. */
export type SharePlan = {
  sharing: boolean;
  /** Why not, or null exactly when sharing. */
  reason: ShareReason | null;
  /** Today's window; null on a day nobody works. */
  startsAt: Date | null;
  endsAt: Date | null;
  /** The next start after now — later today, or the next working day. */
  nextStartsAt: Date | null;
};

export type PersonState = "live" | "recent" | "stale" | "waiting" | "off" | "clocked-out" | "day-off" | "closed";

/** The order the manager's list is read in: who can be seen first, then why the rest cannot. */
export const STATE_ORDER: readonly PersonState[] = ["live", "recent", "stale", "off", "waiting", "clocked-out", "day-off", "closed"];

/** The states that may carry coordinates — and then only a fix from inside today's window. */
const SHOWS_A_FIX: ReadonlySet<PersonState> = new Set<PersonState>(["live", "recent", "stale", "off"]);

export type Place = { latitude: number; longitude: number };
export type Fix = Place & { accuracy: number | null; fixedAt: Date };

/** A StaffLocation row as it is stored, or null for somebody whose phone has said nothing yet. */
export type StoredLocation = {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  fixedAt: Date | null;
  permission: string;
  precise: boolean;
} | null;

// --- The window ----------------------------------------------------------------

/** Today's working window, or null on a day nobody works. The same moments `clockWindows` starts from. */
export function locationWindow(hours: WorkHours, dayKey: string, timeZone: string): LocationWindow | null {
  if (!isWorkingDay(hours, dayKey)) return null;
  const start = instantAt(dayKey, hours.start, timeZone);
  const end = instantAt(dayKey, hours.end, timeZone);
  if (!start || !end || end <= start) return null;
  return { start, end };
}

/** Open from the start up to, and not including, the end. */
export function isOpen(window: LocationWindow | null, now: Date): boolean {
  return !!window && now.getTime() >= window.start.getTime() && now.getTime() < window.end.getTime();
}

/**
 * When the next window opens after `now`: today's if it is still ahead,
 * otherwise the next working day's. Null only if nothing in the next
 * fortnight is a working day — the same fortnight `nextWorkingDay` looks at.
 */
export function nextWindowStart(hours: WorkHours, now: Date, timeZone: string): Date | null {
  const today = dayKeyIn(timeZone, now);
  for (let ahead = 0; ahead <= 14; ahead++) {
    const window = locationWindow(hours, shiftDayKey(today, ahead), timeZone);
    if (window && window.start.getTime() > now.getTime()) return window.start;
  }
  return null;
}

/** Whether the device has seen this person clock out: a departure today, at or before now. */
export function hasClockedOut(departedAt: Date | null, now: Date): boolean {
  return !!departedAt && departedAt.getTime() <= now.getTime();
}

/** Whether the phone's switch is off: the person said no, or the phone is not allowed to ask. */
export function switchedOff(permission: string): boolean {
  return permission === "denied" || permission === "restricted";
}

/** A stored permission as one of the words the app knows; anything else is "unknown". */
export function readPermission(value: string | null | undefined): Permission {
  return (PERMISSIONS as readonly string[]).includes(value ?? "") ? (value as Permission) : "unknown";
}

// --- The phone's side ------------------------------------------------------------

/**
 * Whether a phone should be sharing now, and if not, why.
 *
 * A whole day off comes first, then the window — before it and after it are
 * the general rule — and only inside it does a clock-out matter. `dayOff` is
 * one person's day off; nothing sets it yet, because the platform keeps no
 * record of leave, and a day the studio does not work at all is the same
 * answer reached through `window` being null.
 */
export function sharePlan(input: {
  now: Date;
  window: LocationWindow | null;
  nextStartsAt: Date | null;
  departedAt: Date | null;
  dayOff?: boolean;
}): SharePlan {
  const { now, window, nextStartsAt } = input;
  const plan = (reason: ShareReason | null): SharePlan => ({
    sharing: reason === null,
    reason,
    startsAt: window?.start ?? null,
    endsAt: window?.end ?? null,
    nextStartsAt,
  });

  if (!window || input.dayOff) return plan("day-off");
  if (now.getTime() < window.start.getTime()) return plan("before-hours");
  if (now.getTime() >= window.end.getTime()) return plan("after-hours");
  if (hasClockedOut(input.departedAt, now)) return plan("clocked-out");
  return plan(null);
}

export type Report = { latitude: number; longitude: number; accuracy: number; fixedAt: Date; precise: boolean };

// An instant, with its zone: "2026-10-04T08:12:30Z", with or without a
// fraction, or "+03:00". A time without a zone would be read in the server's
// own, which is UTC in the container and Amman on a laptop.
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * A position as the phone sent it — args [latitude, longitude, accuracy,
 * fixedAt, precise] — checked the way a form field is: the wrong shape is a
 * sentence, not a row.
 *
 * The time matters most. Kept positions are the latest only, so a fix that
 * is old when it arrives would quietly replace where somebody is with where
 * they were; and one from the future would read as live long after it is not.
 */
export function parseReport(args: unknown[], now: Date = new Date()): Report {
  const latitude = finite(args[0]);
  if (latitude === null || latitude < -90 || latitude > 90) {
    throw new RpcError("The latitude must be a number from -90 to 90.");
  }
  const longitude = finite(args[1]);
  if (longitude === null || longitude < -180 || longitude > 180) {
    throw new RpcError("The longitude must be a number from -180 to 180.");
  }
  const accuracy = finite(args[2]);
  if (accuracy === null || accuracy < 0 || accuracy > MAX_ACCURACY_METRES) {
    throw new RpcError("The accuracy must be a number of metres from 0 to 50,000.");
  }

  const fixedAt = typeof args[3] === "string" && ISO_INSTANT.test(args[3]) ? new Date(args[3]) : null;
  if (!fixedAt || Number.isNaN(fixedAt.getTime())) {
    throw new RpcError("The time of the position must be an ISO date with its timezone.");
  }
  const ahead = fixedAt.getTime() - now.getTime();
  if (ahead > AHEAD_REPORT_MINUTES * MINUTE) {
    throw new RpcError("The time of the position is ahead of the server's clock. Check the phone's date and time.");
  }
  if (-ahead > OLDEST_REPORT_MINUTES * MINUTE) {
    throw new RpcError(`That position is more than ${OLDEST_REPORT_MINUTES} minutes old, so it was not kept.`);
  }

  return { latitude, longitude, accuracy, fixedAt, precise: bool(args[4]) };
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** Whether a fix was taken inside the window — the only fixes that are ever kept. */
export function insideWindow(fixedAt: Date, window: LocationWindow | null): boolean {
  return isOpen(window, fixedAt);
}

// --- The manager's side ----------------------------------------------------------

export type PersonFacts = {
  now: Date;
  window: LocationWindow | null;
  /** Today's departure, as the fingerprint device's sync wrote it. */
  departedAt: Date | null;
  dayOff?: boolean;
  permission: string;
  /** The stored fix, whatever its age; which of it may be shown is decided here. */
  fix: Fix | null;
};

/**
 * One person, as the map shows them.
 *
 * The same order of questions as `sharePlan`, so the manager's list and the
 * person's own phone never disagree: a day off, then the window ("closed"
 * stands for the phone's before-hours and after-hours), then a clock-out,
 * then the phone's switch, and only then how old the position is.
 */
export function personState(facts: PersonFacts): PersonState {
  const { now, window } = facts;
  if (!window || facts.dayOff) return "day-off";
  if (!isOpen(window, now)) return "closed";
  if (hasClockedOut(facts.departedAt, now)) return "clocked-out";
  // Switched off keeps a position from earlier today: where they were when it
  // went off is still worth showing, and is shown as exactly that.
  if (switchedOff(facts.permission)) return "off";

  const fix = todaysFix(facts);
  if (!fix) return "waiting";
  const age = now.getTime() - fix.fixedAt.getTime();
  if (age <= LIVE_MINUTES * MINUTE) return "live";
  if (age <= RECENT_MINUTES * MINUTE) return "recent";
  return "stale";
}

/**
 * The fix the manager may see, or null: only for a state that shows one, and
 * only a fix taken inside today's window and before any clock-out. The
 * keeper wipes everything else anyway; this is what makes the read safe even
 * on a day the scheduler did not run.
 */
export function shownFix(facts: PersonFacts, state: PersonState = personState(facts)): Fix | null {
  return SHOWS_A_FIX.has(state) ? todaysFix(facts) : null;
}

function todaysFix({ fix, window, departedAt }: PersonFacts): Fix | null {
  if (!fix || !insideWindow(fix.fixedAt, window)) return null;
  if (departedAt && fix.fixedAt.getTime() > departedAt.getTime()) return null;
  return fix;
}

/** A stored row's position, when it has one at all. */
export function fixOf(stored: StoredLocation): Fix | null {
  if (!stored || stored.latitude === null || stored.longitude === null || !stored.fixedAt) return null;
  return { latitude: stored.latitude, longitude: stored.longitude, accuracy: stored.accuracy, fixedAt: stored.fixedAt };
}

const EARTH_RADIUS_METRES = 6_371_000;

/** The distance between two points on the ground, in metres (haversine). */
export function metresBetween(a: Place, b: Place): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Whether a fix puts somebody at the office. The phone's own accuracy is
 * given the benefit of the doubt — a fix 200 m out that is only good to 80 m
 * may well be at the door — but no more than 100 m of it, so a fix that is
 * good to a kilometre cannot put anybody anywhere.
 */
export function atOffice(fix: Place & { accuracy: number | null }, office: Place): boolean {
  const allowance = Math.min(Math.max(fix.accuracy ?? 0, 0), ACCURACY_ALLOWANCE_METRES);
  return metresBetween(fix, office) - allowance <= OFFICE_RADIUS_METRES;
}

/** One person on the map — a row of `team/locations`, word for word. */
export type PersonRow = {
  id: string;
  name: string;
  photoUrl: string | null;
  role: string | null;
  state: PersonState;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  fixedAt: Date | null;
  precise: boolean;
  permission: Permission;
  atOffice: boolean | null;
  metresFromOffice: number | null;
  arrivedAt: Date | null;
  departedAt: Date | null;
};

export function personRow(input: {
  person: { id: string; name: string; photoUrl: string | null; role: string | null };
  stored: StoredLocation;
  attendance: { arrivedAt: Date | null; departedAt: Date | null } | null;
  now: Date;
  window: LocationWindow | null;
  office: Place | null;
  dayOff?: boolean;
}): PersonRow {
  const { person, stored, attendance, office } = input;
  const facts: PersonFacts = {
    now: input.now,
    window: input.window,
    departedAt: attendance?.departedAt ?? null,
    dayOff: input.dayOff,
    permission: readPermission(stored?.permission),
    fix: fixOf(stored),
  };
  const state = personState(facts);
  const fix = shownFix(facts, state);

  return {
    id: person.id,
    name: person.name,
    photoUrl: person.photoUrl,
    role: person.role,
    state,
    latitude: fix?.latitude ?? null,
    longitude: fix?.longitude ?? null,
    accuracy: fix?.accuracy ?? null,
    fixedAt: fix?.fixedAt ?? null,
    // The phone's switches, which are not a position and are shown at any hour.
    precise: stored?.precise ?? true,
    permission: readPermission(stored?.permission),
    atOffice: fix && office ? atOffice(fix, office) : null,
    metresFromOffice: fix && office ? Math.round(metresBetween(fix, office)) : null,
    arrivedAt: attendance?.arrivedAt ?? null,
    departedAt: attendance?.departedAt ?? null,
  };
}

/** The list's order: by state (STATE_ORDER), then by name. */
export function byStateThenName(a: { state: PersonState; name: string }, b: { state: PersonState; name: string }): number {
  return STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || a.name.localeCompare(b.name);
}

// --- Asking a phone for a fresh position ---------------------------------------------

export type PingCandidate = {
  id: string;
  permission: string;
  fixedAt: Date | null;
  pingedAt: Date | null;
  departedAt: Date | null;
  dayOff?: boolean;
};

/**
 * Whose phones to wake with a silent push: while the window is open, anybody
 * still shared — not clocked out, not off for the day, the switch not off —
 * whose last position is older than `quietMinutes` (or who has none), and who
 * was not asked within the same span. The manager's Refresh asks with
 * REFRESH_MINUTES, the scheduler with KEEPER_MINUTES. The scheduler's loop
 * sleeps a minute after its jobs, so it only ever runs late, never early, and
 * needs no allowance the way "every two minutes" does in clock-reminders.ts.
 *
 * Apple rations silent pushes per phone and drops the excess without saying
 * so; asking a phone that has just answered, or was just asked, would spend
 * that ration on nothing.
 */
export function whoToPing(input: {
  now: Date;
  window: LocationWindow | null;
  people: PingCandidate[];
  quietMinutes: number;
}): string[] {
  const { now, window, people } = input;
  if (!isOpen(window, now)) return [];
  const t = now.getTime();
  const quiet = input.quietMinutes * MINUTE;

  return people
    .filter((person) => {
      if (person.dayOff || hasClockedOut(person.departedAt, now) || switchedOff(person.permission)) return false;
      if (person.fixedAt && t - person.fixedAt.getTime() <= quiet) return false;
      if (person.pingedAt && t - person.pingedAt.getTime() < quiet) return false;
      return true;
    })
    .map((person) => person.id);
}

// --- The office ----------------------------------------------------------------------

/** Where the office is, as stored (AppSetting `office_location`, JSON), or null. */
export function readOffice(raw: string | null | undefined): Place | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { latitude, longitude } = parsed as Record<string, unknown>;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (!(Math.abs(latitude) <= 90) || !(Math.abs(longitude) <= 180)) return null;
  return { latitude, longitude };
}

/** The office from the manager's phone: args [latitude, longitude] sets it, [] or [null] clears it. */
export function officeFromArgs(args: unknown[]): Place | null {
  if (args[0] === null || args[0] === undefined) return null;
  const latitude = finite(args[0]);
  if (latitude === null || latitude < -90 || latitude > 90) {
    throw new RpcError("The office's latitude must be a number from -90 to 90.");
  }
  const longitude = finite(args[1]);
  if (longitude === null || longitude < -180 || longitude > 180) {
    throw new RpcError("The office's longitude must be a number from -180 to 180.");
  }
  return { latitude, longitude };
}
