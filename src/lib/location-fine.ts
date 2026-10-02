import { RpcError, str } from "@/lib/mobile/rpc";
import { periodOf } from "@/lib/payroll";
import { isOpen, locationWindow, type LocationWindow } from "@/lib/staff-location";
import { dateToDayKey, dayKeyIn, dayKeyToDate, instantAt, shiftDayKey } from "@/lib/time";
import type { WorkHours } from "@/lib/work-hours";

// The 1 JOD a working day without location — which days can cost it, who is
// warned and when, and what the payslip and the notifications say. Pure, so
// the rules that decide money are pinned by tests rather than by hope;
// lib/location-fine-store.ts reads and writes, and
// lib/notifications/location-fines.ts runs it on the location keeper's pass.
//
// What the studio asked for: "Every employee who didn't turn on his location
// on a day gets a pay cut of 1 JD for that day — notify them all, and cut
// automatically." What comes with it, and is part of the feature rather than a
// setting, because it is what keeps a flat battery or a server that was down
// from costing anybody a dinar:
// - only a working day counts, and only one on which the fingerprint device
//   saw the person arrive while the window was open. The device not seeing
//   somebody is not their phone's fault, and absence is a separate matter;
// - one position stored from inside the window, at any hour of it, is enough;
// - the rule is announced to everybody first, and a day counts for somebody
//   only if it started after they were told — never retroactively;
// - a day is charged only if its warning went out during it (an hour in, and
//   an hour before the end). So a server that was down all day charges
//   nobody: it was not there to warn, and it could not have stored a position
//   either;
// - a day is decided between the window's end and midnight and at no other
//   time, so a day the server missed is never charged later;
// - the manager can cancel any day, and the month is counted again from the
//   days rather than adjusted by hand.
//
// Every word sent says what reached NEON and what did not — never that
// anybody switched anything off, refused or forgot. The platform cannot tell a
// flat battery from a phone left at home from location turned off, and the
// wording must not choose for it.

const MINUTE = 60_000;

/** What a working day without location costs, in JOD. */
export const FINE_JOD = 1;

/** The kind on the SalaryAdjustment row: one per person per month, counted from the days. */
export const FINE_KIND = "LOCATION";

/**
 * AppSetting holding whether the rule is on. Unset means on — the studio asked
 * for it, and a switch nobody has touched does what was asked; only an
 * explicit "false" (the manager's switch on the map) turns it off.
 */
export const FINE_KEY = "location_fine";

/**
 * AppSetting holding when the rule was announced to the team (ISO). Turning
 * the rule off deletes it, so turning it on again announces it again and
 * starts the notice over.
 */
export const FINE_ANNOUNCED_KEY = "location_fine_announced_at";

/** The first warning goes this long after the window opens... */
export const WARN_AFTER_START_MINUTES = 60;
/** ...and the second this long before it closes. */
export const WARN_BEFORE_END_MINUTES = 60;

// --- The switch and the notice -------------------------------------------------------

/** Whether the rule is on: unset is on, only "false" is off (the same reading as `readRequired`). */
export function readFineOn(raw: string | null | undefined): boolean {
  return (raw ?? "").trim().toLowerCase() !== "false";
}

/** The announcement stamp as stored, or null for none — or for one that is not a time at all. */
export function readAnnouncedAt(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Whether a day can cost anything: only if its window started after the rule
 * was announced. A day already under way when the notice arrived is not one
 * anybody could have acted on, so the notice is never retroactive — not even
 * by an hour.
 */
export function countsForFine(input: { windowStart: Date; announcedAt: Date | null }): boolean {
  return !!input.announcedAt && input.windowStart.getTime() > input.announcedAt.getTime();
}

/**
 * When somebody counts as told: when their notice was written, but never
 * before the announcement itself — a day counts only if it started after
 * both, whatever two clocks made of the moment in between. Null until their
 * notice has been written.
 */
export function toldAt(announcedAt: Date, noticeAt: Date | null | undefined): Date | null {
  if (!noticeAt) return null;
  return noticeAt.getTime() > announcedAt.getTime() ? noticeAt : announcedAt;
}

/**
 * The first working day that counts after an announcement, as YYYY-MM-DD: the
 * day itself if its window had not started yet, otherwise the next working
 * day. Null with no announcement, or nothing worked in the fortnight after it.
 */
export function fineStartsOn(input: { hours: WorkHours; announcedAt: Date | null; timeZone: string }): string | null {
  const { hours, announcedAt, timeZone } = input;
  if (!announcedAt) return null;
  const from = dayKeyIn(timeZone, announcedAt);
  for (let ahead = 0; ahead <= 14; ahead++) {
    const dayKey = shiftDayKey(from, ahead);
    const window = locationWindow(hours, dayKey, timeZone);
    if (window && countsForFine({ windowStart: window.start, announcedAt })) return dayKey;
  }
  return null;
}

/** The rule as the phone and the map are told it — `fine` on `me/location` and `team/locations`. */
export type FineRule = { on: boolean; amount: number; startsOn: string | null };

export function fineRule(on: boolean, startsOn: string | null): FineRule {
  return { on, amount: FINE_JOD, startsOn: on ? startsOn : null };
}

/**
 * The manager's switch, args [true | false]. Anything else is refused rather
 * than read as off: turning this off also clears the notice, so a missing
 * argument must not be able to do it.
 */
export function fineSwitch(args: unknown[]): boolean {
  const value = args[0];
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  throw new RpcError("Send true to turn the 1 JOD a day without location on, or false to turn it off.");
}

// --- One person's day ---------------------------------------------------------------

/** One person's working day, as the warnings and the charge are decided on it. */
export type FineDay = {
  id: string;
  /** Today's arrival, as the fingerprint device's sync stored it. */
  arrivedAt: Date | null;
  /** Today's departure, likewise — only a clock-out the device can vouch for (lib/attendance.ts). */
  departedAt: Date | null;
  /** Positions from their phone stored inside today's window (LocationDay.fixes; 0 with no row). */
  fixes: number;
  warnedAt: Date | null;
  warned2At: Date | null;
  finedAt: Date | null;
  forgivenAt: Date | null;
  /** When the rule was announced to this person; null until it has been. */
  announcedAt: Date | null;
};

export type WarningDue = { employeeId: string; warning: 1 | 2 };

/**
 * When the day's two warnings fall: an hour in, and an hour before the end —
 * but the second never before the first, so a short day gets one warning
 * rather than two at once.
 */
export function warningTimes(window: LocationWindow) {
  const first = new Date(window.start.getTime() + WARN_AFTER_START_MINUTES * MINUTE);
  const second = new Date(Math.max(window.end.getTime() - WARN_BEFORE_END_MINUTES * MINUTE, first.getTime()));
  return { first, second };
}

/**
 * Who is warned now, and with which warning: while the window is open, on a
 * day that counts for them, anybody the device has seen arrive whose phone has
 * not had one position stored yet — the first from an hour in, the second
 * from an hour before the end, each once.
 *
 * The first is due until the second's time; after that only the second, so
 * somebody arriving late, or a scheduler back from a gap, sends one push and
 * not two. Nobody is warned once the device has seen them clock out: the plan
 * stops their phone sharing from that moment, so the warning's advice could
 * no longer help.
 */
export function warningsDue(input: { now: Date; window: LocationWindow | null; people: FineDay[] }): WarningDue[] {
  const { now, window, people } = input;
  if (!window || !isOpen(window, now)) return [];
  const t = now.getTime();
  const { first, second } = warningTimes(window);
  const due: WarningDue[] = [];

  for (const person of people) {
    if (!countsForFine({ windowStart: window.start, announcedAt: person.announcedAt })) continue;
    if (!person.arrivedAt || person.arrivedAt.getTime() > t) continue;
    if (person.fixes > 0) continue;
    if (person.departedAt && person.departedAt.getTime() <= t) continue;

    if (t >= second.getTime()) {
      if (!person.warned2At) due.push({ employeeId: person.id, warning: 2 });
    } else if (t >= first.getTime()) {
      if (!person.warnedAt) due.push({ employeeId: person.id, warning: 1 });
    }
  }
  return due;
}

/** Midnight at the end of a day in the studio's timezone: the last moment that day can be decided. */
export function dayEndOf(dayKey: string, timeZone: string): Date {
  const next = shiftDayKey(dayKey, 1);
  return instantAt(next, "00:00", timeZone) ?? dayKeyToDate(next);
}

/**
 * Who is charged for today: from the window's end until midnight, anybody
 * on a day that counts for them whom the device saw arrive before the window
 * closed, with no position from their phone stored inside it, who was warned
 * during it, and whose day is not decided yet.
 *
 * Arriving after the close cannot count — no position could have been kept
 * then, whatever the phone did. And a day nobody was warned on is a day the
 * server did not see: charging for it would be charging for the outage.
 */
export function finesDue(input: { now: Date; window: LocationWindow | null; people: FineDay[]; dayEnd: Date }): string[] {
  const { now, window, people, dayEnd } = input;
  if (!window) return [];
  const t = now.getTime();
  if (t < window.end.getTime() || t >= dayEnd.getTime()) return [];

  return people
    .filter((person) => {
      if (!countsForFine({ windowStart: window.start, announcedAt: person.announcedAt })) return false;
      if (!person.arrivedAt || person.arrivedAt.getTime() >= window.end.getTime()) return false;
      if (person.fixes > 0) return false;
      if (!person.warnedAt && !person.warned2At) return false;
      return !person.finedAt && !person.forgivenAt;
    })
    .map((person) => person.id);
}

// --- The month ----------------------------------------------------------------------

type Decided = { finedAt: Date | null; forgivenAt: Date | null };

/** A day that costs: charged, and not cancelled since. */
export function isCharged(day: Decided): boolean {
  return !!day.finedAt && !day.forgivenAt;
}

/** What these days cost together: the charged ones, a dinar each. */
export function fineAmount(days: Decided[]): number {
  return days.filter(isCharged).length * FINE_JOD;
}

/**
 * The charged days, by the payroll month each belongs to (`periodOf`, the
 * same months payroll sums by), oldest first. One SalaryAdjustment row each.
 */
export function finesByMonth(days: (Decided & { day: string })[]): Map<string, string[]> {
  const months = new Map<string, string[]>();
  for (const day of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
    if (!isCharged(day)) continue;
    const period = periodOf(day.day);
    months.set(period, [...(months.get(period) ?? []), day.day]);
  }
  return months;
}

/**
 * A month's row: the amount and the reason, or null when nothing in it is
 * charged — and then the row goes, rather than staying at zero.
 */
export function monthAdjustment(dayKeys: string[]): { amount: number; reason: string } | null {
  if (dayKeys.length === 0) return null;
  return { amount: dayKeys.length * FINE_JOD, reason: fineReason(dayKeys) };
}

/** Why, as payroll shows it beside the amount: every day named, so each can be checked. */
export function fineReason(dayKeys: string[]): string {
  const days = [...dayKeys].sort().map(dayLabel).join(", ");
  return `No location reached NEON from the phone during working hours on ${days} — ${FINE_JOD} JOD a day.`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Written out rather than through Intl: a reason is stored on a payslip, and
// the same day must not read "30 Sep" on one machine and "30 Sept" on another.

/** "3 Oct". */
export function dayLabel(dayKey: string): string {
  const [, month, day] = dayKey.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

/** "Sat 3 Oct". */
export function dayName(dayKey: string): string {
  return `${WEEKDAYS[dayKeyToDate(dayKey).getUTCDay()]} ${dayLabel(dayKey)}`;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day as YYYY-MM-DD, or null — "2026-02-30" is not one, though Date would roll it into March. */
export function readDayKey(value: unknown): string | null {
  if (typeof value !== "string" || !DAY_KEY.test(value)) return null;
  const date = dayKeyToDate(value);
  return Number.isNaN(date.getTime()) || dateToDayKey(date) !== value ? null : value;
}

/** The manager's undo, args [employeeId, "YYYY-MM-DD"]. */
export function forgiveArgs(args: unknown[]): { employeeId: string; dayKey: string } {
  const employeeId = str(args[0], "employeeId");
  const dayKey = readDayKey(args[1]);
  if (!dayKey) throw new RpcError("The day must be a date, as YYYY-MM-DD.");
  return { employeeId, dayKey };
}

// --- What is said, and the keys that say it once ------------------------------------

export type Copy = { title: string; message: string };

/** The one notice, before any day counts. `startsOn` is the first working day that does. */
export function noticeCopy(startsOn: string | null): Copy {
  const from = startsOn ? `From ${dayName(startsOn)}, ` : "";
  return {
    title: "Location during working hours",
    message:
      `${from}${FINE_JOD} JOD is deducted for a working day on which the fingerprint sees you arrive ` +
      `and no location from your phone reaches NEON during working hours. ` +
      `Keep location on for NEON (Always) — it is only shared during working hours.`,
  };
}

/** The day's warnings: the first an hour in, the second an hour before the end. */
export function warningCopy(warning: 1 | 2, times: { startsAt: string; endsAt: string }): Copy {
  return warning === 1
    ? {
        title: "Your location hasn't reached NEON today",
        message:
          `No location from your phone has reached NEON since the day started at ${times.startsAt}. ` +
          `Open NEON with location on (Always) so today isn't charged ${FINE_JOD} JOD.`,
      }
    : {
        title: "Your location still hasn't reached NEON today",
        message:
          `The day ends at ${times.endsAt} and no location from your phone has reached NEON yet. ` +
          `Open NEON with location on (Always) so today isn't charged ${FINE_JOD} JOD.`,
      };
}

/** The charge, to the person. */
export function fineCopy(dayKey: string): Copy {
  return {
    title: `${FINE_JOD} JOD deducted for ${dayName(dayKey)}`,
    message:
      `${FINE_JOD} JOD was deducted for ${dayName(dayKey)} because no location from your phone reached NEON ` +
      `during working hours. If that's wrong, tell the manager.`,
  };
}

/** The undo, to the person. */
export function forgivenCopy(dayKey: string): Copy {
  return {
    title: `${dayName(dayKey)}: ${FINE_JOD} JOD cancelled`,
    message:
      `The manager cancelled the ${FINE_JOD} JOD deducted for ${dayName(dayKey)}, when no location reached NEON ` +
      `during working hours. It is no longer taken off your pay.`,
  };
}

/** The manager's one word for the evening: everybody charged that day, by name. */
export function managerCopy(names: string[], dayKey: string): Copy {
  const one = names.length === 1;
  return {
    title: one ? `${FINE_JOD} JOD deducted from ${names[0]}` : `${FINE_JOD} JOD deducted from ${names.length} people`,
    message:
      `${dayName(dayKey)}: the fingerprint saw ${listOf(names)} arrive, and no location from ` +
      `${one ? "their phone" : "their phones"} reached NEON during working hours, so ${FINE_JOD} JOD ` +
      `${one ? "was" : "each was"} deducted. It is on the month's payroll, and a day can be cancelled if it shouldn't count.`,
  };
}

/** "Lina", "Lina and Omar", "Lina, Omar and Sami". */
export function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// Every key is derived from what happened, never from the clock, so a pass
// that runs twice — or two at once — says each thing once.

/** The notice, once per person per announcement: turning the rule off and on again announces it again. */
export function noticeKey(employeeId: string, announcedAt: string): string {
  return `LOCATION_FINE_NOTICE:${employeeId}:${announcedAt}`;
}

export function warningKey(warning: 1 | 2, employeeId: string, dayKey: string): string {
  return `LOCATION_WARNING:${warning}:${employeeId}:${dayKey}`;
}

export function fineKey(employeeId: string, dayKey: string): string {
  return `LOCATION_FINE:${employeeId}:${dayKey}`;
}

export function forgivenKey(employeeId: string, dayKey: string): string {
  return `LOCATION_FORGIVEN:${employeeId}:${dayKey}`;
}

/** The manager's, once an evening. */
export function managerFineKey(dayKey: string): string {
  return `LOCATION_FINES:${dayKey}`;
}
