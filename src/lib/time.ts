// Calendar maths in the company's timezone.
//
// "Today" and "tomorrow" are calendar questions, not instants: a task on the
// 9th is on the 9th in Amman regardless of where the server runs. Timestamps
// stay UTC in the database; these helpers convert at the edges — for display,
// for the scheduled jobs, and for the day a task belongs to.

export const DEFAULT_TIMEZONE = "Asia/Amman";

export function resolveTimezone(configured?: string | null) {
  const candidate = configured || process.env.APP_TIMEZONE || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    // An unusable timezone must not take the scheduler down with it.
    return DEFAULT_TIMEZONE;
  }
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

function partsIn(timeZone: string, instant: Date): Parts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const found: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") found[part.type] = part.value;
  }

  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    // Intl gives "24" for midnight in some locales/environments.
    hour: Number(found.hour) % 24,
    minute: Number(found.minute),
  };
}

/** The calendar day in `timeZone`, as YYYY-MM-DD. */
export function dayKeyIn(timeZone: string, instant: Date = new Date()) {
  const { year, month, day } = partsIn(timeZone, instant);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The local wall-clock hour in `timeZone` (0-23). */
export function hourIn(timeZone: string, instant: Date = new Date()) {
  return partsIn(timeZone, instant).hour;
}

/** Shifts a YYYY-MM-DD key by whole days without touching timezones. */
export function shiftDayKey(dayKey: string, days: number) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/**
 * A day key as the UTC midnight Date that Postgres `@db.Date` columns store.
 * Comparing dates then never depends on the server's own offset.
 */
export function dayKeyToDate(dayKey: string) {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

export function dateToDayKey(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function todayKey(timeZone: string) {
  return dayKeyIn(timeZone);
}

export function tomorrowKey(timeZone: string) {
  return shiftDayKey(dayKeyIn(timeZone), 1);
}

/** "3:00 PM" in the company timezone, for notification and task copy. */
export function formatTimeIn(timeZone: string, instant: Date | null | undefined) {
  if (!instant) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
}

export function formatDayIn(timeZone: string, instant: Date | null | undefined) {
  if (!instant) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(instant);
}
