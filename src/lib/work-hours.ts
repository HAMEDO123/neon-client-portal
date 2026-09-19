// The studio's working day: when it starts, when it ends, when lunch is, and
// how many minutes of it can actually be planned.
//
// Pure on purpose, and the single source of these answers. Planning, follow-ups
// and notifications all read from here, so changing the hours in Settings moves
// every one of them together — and a follow-up can never be timed into lunch or
// into the evening because each of those callers remembered separately.
//
// Times are wall-clock in the company timezone, as "HH:MM". Days are calendar
// day keys, "YYYY-MM-DD". Neither depends on where the server runs.

export type WorkHours = {
  /** Working days as JavaScript weekdays: 0 is Sunday. */
  days: number[];
  /** "HH:MM", the start of the working day. */
  start: string;
  /** "HH:MM", the end of it. */
  end: string;
  /** How long lunch is. */
  lunchMinutes: number;
  /** "HH:MM", when lunch begins. */
  lunchAt: string;
  /** Minutes deliberately left unplanned, for the day going wrong. */
  bufferMinutes: number;
  /**
   * Minutes past the start that still count as on time — the studio's own
   * allowance, 5 here, so arriving by 11:05 is not late.
   *
   * It lives with the working day because it is part of what the day *is*, and
   * because it decides pay: `lateHours` takes it off before charging anything.
   */
  graceMinutes: number;
};

/** What the studio runs on until somebody says otherwise. */
export const DEFAULT_WORK_HOURS: WorkHours = {
  // Sunday to Thursday, the working week here.
  days: [0, 1, 2, 3, 4],
  start: "11:00",
  end: "19:00",
  lunchMinutes: 30,
  lunchAt: "14:00",
  bufferMinutes: 0,
  // Zero until a studio says otherwise. An allowance is a policy about people's
  // pay, and a default that invented one would hand back money nobody agreed to
  // give; this studio's 5 minutes is saved in Settings, not written in here.
  graceMinutes: 0,
};

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" as minutes since midnight, or null if it is not a time. */
export function minutesOf(time: string): number | null {
  const match = TIME.exec(time.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes since midnight as "HH:MM", clamped into the day. */
export function timeOf(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/**
 * Reads the stored settings, falling back to the default for anything missing
 * or unusable. Settings come from a text column that a person edits, so every
 * value is treated as a suggestion until it parses.
 */
export function parseWorkHours(raw: Partial<Record<keyof WorkHours, string | null>>): WorkHours {
  // Empty parts are dropped before they are read as numbers: "" becomes 0,
  // which is a perfectly valid Sunday, so an unset setting would otherwise
  // parse as "Sundays only" instead of falling back to the working week.
  const days = (raw.days ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);

  const start = minutesOf(raw.start ?? "") == null ? DEFAULT_WORK_HOURS.start : (raw.start as string).trim();
  const end = minutesOf(raw.end ?? "") == null ? DEFAULT_WORK_HOURS.end : (raw.end as string).trim();

  // A day that ends before it starts is not a day; keep the default rather than
  // producing negative capacity everywhere downstream.
  const ordered = (minutesOf(start) as number) < (minutesOf(end) as number);

  const lunchAt = minutesOf(raw.lunchAt ?? "") == null ? DEFAULT_WORK_HOURS.lunchAt : (raw.lunchAt as string).trim();

  return {
    days: days.length > 0 ? [...new Set(days)].sort() : DEFAULT_WORK_HOURS.days,
    start: ordered ? start : DEFAULT_WORK_HOURS.start,
    end: ordered ? end : DEFAULT_WORK_HOURS.end,
    lunchMinutes: minutesSetting(raw.lunchMinutes, DEFAULT_WORK_HOURS.lunchMinutes),
    lunchAt,
    bufferMinutes: minutesSetting(raw.bufferMinutes, DEFAULT_WORK_HOURS.bufferMinutes),
    graceMinutes: minutesSetting(raw.graceMinutes, DEFAULT_WORK_HOURS.graceMinutes),
  };
}

/**
 * A number of minutes from a setting, or the default when none was saved.
 *
 * Unset must not become zero. Settings arrive as null for anything the studio
 * has not chosen, and `Number(null)` is 0 — a perfectly valid "no lunch at
 * all", which would silently hand every plan an extra half hour it does not
 * have. Nothing is read as a number until it is known to be there.
 */
function minutesSetting(value: string | null | undefined, fallback: number): number {
  if (value == null || String(value).trim() === "") return fallback;

  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes >= 8 * 60) return fallback;
  return Math.round(minutes);
}

/** How long the working day is, lunch included. */
export function spanMinutes(hours: WorkHours): number {
  return (minutesOf(hours.end) ?? 0) - (minutesOf(hours.start) ?? 0);
}

/** Lunch, as the window it occupies. */
export function lunchWindow(hours: WorkHours): { from: number; to: number } {
  const from = minutesOf(hours.lunchAt) ?? 0;
  return { from, to: from + hours.lunchMinutes };
}

/**
 * The minutes a day can actually hold: its span, less lunch, less the buffer
 * kept back for the day going wrong. 11:00–19:00 with a half-hour lunch is 450.
 */
export function capacityMinutes(hours: WorkHours): number {
  return Math.max(0, spanMinutes(hours) - hours.lunchMinutes - hours.bufferMinutes);
}

/** The weekday of a day key, 0 for Sunday, without touching timezones. */
export function weekdayOf(dayKey: string): number {
  return new Date(`${dayKey}T00:00:00.000Z`).getUTCDay();
}

export function isWorkingDay(hours: WorkHours, dayKey: string): boolean {
  return hours.days.includes(weekdayOf(dayKey));
}

function shift(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * The next day that is actually worked, starting from the day after this one.
 * "Tomorrow" on a Thursday is Sunday, and the caller is expected to say so
 * rather than quietly planning a day nobody is there for.
 */
export function nextWorkingDay(hours: WorkHours, dayKey: string): string {
  for (let i = 1; i <= 14; i++) {
    const candidate = shift(dayKey, i);
    if (isWorkingDay(hours, candidate)) return candidate;
  }
  // Nothing is a working day: say tomorrow rather than loop for ever.
  return shift(dayKey, 1);
}

/** Is this wall-clock time inside the working day, and not in lunch? */
export function isWorkingTime(hours: WorkHours, time: string): boolean {
  const at = minutesOf(time);
  if (at == null) return false;

  const lunch = lunchWindow(hours);
  if (at >= lunch.from && at < lunch.to) return false;

  return at >= (minutesOf(hours.start) ?? 0) && at < (minutesOf(hours.end) ?? 0);
}

/**
 * How much of a day is left to plan, from a moment inside it.
 *
 * Planning at 14:30 must not propose a nine-hour day: what is left is what is
 * left, lunch taken off if it has not happened yet.
 */
export function remainingMinutes(hours: WorkHours, time: string): number {
  const now = minutesOf(time);
  if (now == null) return capacityMinutes(hours);

  const start = minutesOf(hours.start) ?? 0;
  const end = minutesOf(hours.end) ?? 0;
  if (now >= end) return 0;

  const from = Math.max(now, start);
  const lunch = lunchWindow(hours);
  // Only the part of lunch still ahead is taken off.
  const lunchLeft = Math.max(0, Math.min(lunch.to, end) - Math.max(lunch.from, from));

  return Math.max(0, end - from - lunchLeft - hours.bufferMinutes);
}

/**
 * When a message meant for `time` should actually be sent.
 *
 * Nobody is chased during lunch or after they have gone home: a follow-up that
 * falls outside the working day moves to the next moment somebody is at work.
 */
export function nextWorkingMoment(
  hours: WorkHours,
  dayKey: string,
  time: string
): { dayKey: string; time: string } {
  const at = minutesOf(time) ?? 0;
  const start = minutesOf(hours.start) ?? 0;
  const end = minutesOf(hours.end) ?? 0;
  const lunch = lunchWindow(hours);

  if (!isWorkingDay(hours, dayKey)) {
    return { dayKey: nextWorkingDay(hours, dayKey), time: hours.start };
  }
  if (at < start) return { dayKey, time: hours.start };
  if (at >= end) return { dayKey: nextWorkingDay(hours, dayKey), time: hours.start };
  if (at >= lunch.from && at < lunch.to) return { dayKey, time: timeOf(lunch.to) };

  return { dayKey, time: timeOf(at) };
}
