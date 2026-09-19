import { isWorkingDay, weekdayOf, type WorkHours } from "@/lib/work-hours";

// A month of attendance as a grid: people down the side, every day across the top.
//
// Pure, like the rest of attendance. Not because this decides money — it only
// shows what already did — but because month boundaries are where a calendar
// goes wrong quietly: a 28-day February, a year turning over, a day key built
// from the server's own clock instead of the studio's. None of that announces
// itself on screen; somebody's Tuesday simply appears in Monday's column.
//
// **An empty cell means nothing was recorded, and never that somebody was
// absent.** The platform cannot tell "did not come" from "the device did not
// read them" from "nobody has synced yet" — the same refusal the day board
// makes about silence. The screen says so in as many words, because a grid of
// blanks is exactly the shape that invites the other reading.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export type MonthDay = {
  dayKey: string;
  /** 1–31, for the column heading. */
  dayOfMonth: number;
  /** 0 is Sunday, as everywhere else here. */
  weekday: number;
  /** Whether the studio works this day — read from Settings, never a hard-coded weekend. */
  worked: boolean;
  isToday: boolean;
  /** Later than today: nothing can have been recorded yet, so a blank says nothing at all. */
  isFuture: boolean;
};

/** One recorded day, flattened out of the database row. */
export type MonthEntry = {
  employeeId: string;
  dayKey: string;
  delayHours: number;
  /** MANUAL or DEVICE — who put the figure there. */
  source: string;
  note: string | null;
};

export type MonthPerson = { id: string; name: string; active: boolean };

export type MonthRow = {
  employeeId: string;
  name: string;
  active: boolean;
  /** One per day of the month, in the same order as `days`. */
  cells: (MonthEntry | null)[];
  /** How many days of the month have a record at all. */
  daysRecorded: number;
  /** The month's lateness, summed. */
  hoursLate: number;
};

export type Month = { monthKey: string; days: MonthDay[]; rows: MonthRow[] };

/**
 * The month a URL names, or the one we are in.
 *
 * Anything unreadable becomes this month rather than something arbitrary — the
 * same shape as `cutoffFor`, and for the same reason: a screen reached from a
 * typo should show the obvious thing, not an empty grid from the year 0.
 */
export function monthKeyFor(value: string | undefined | null, todayKey: string): string {
  return typeof value === "string" && MONTH.test(value) ? value : todayKey.slice(0, 7);
}

/** Every day of a month, as day keys. */
export function monthDayKeys(monthKey: string): string[] {
  const [year, month] = monthKey.split("-").map(Number);
  // Day 0 of the next month is the last day of this one, which gets February
  // right — and leap years with it — without a table of lengths or a rule.
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const keys: string[] = [];
  for (let day = 1; day <= length; day++) keys.push(`${monthKey}-${String(day).padStart(2, "0")}`);
  return keys;
}

/** The month before or after this one, over a year boundary as readily as inside it. */
export function shiftMonth(monthKey: string, months: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const moved = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "September 2026", for the heading. */
export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, 1))
  );
}

/** The first and last day of a month, for a query over `@db.Date` columns. */
export function monthBounds(monthKey: string): { from: string; to: string } {
  const days = monthDayKeys(monthKey);
  return { from: days[0], to: days[days.length - 1] };
}

/**
 * The grid itself: the month's days, and one row per person with a cell for
 * each of them.
 *
 * Cells are positional rather than keyed, so the component renders a row by
 * walking two arrays of the same length and cannot drift a person's day into
 * the wrong column by looking something up with a key it built itself.
 */
export function buildMonth(input: {
  monthKey: string;
  hours: WorkHours;
  todayKey: string;
  people: MonthPerson[];
  entries: MonthEntry[];
}): Month {
  const { monthKey, hours, todayKey, people, entries } = input;

  const days: MonthDay[] = monthDayKeys(monthKey).map((dayKey) => ({
    dayKey,
    dayOfMonth: Number(dayKey.slice(-2)),
    weekday: weekdayOf(dayKey),
    worked: isWorkingDay(hours, dayKey),
    isToday: dayKey === todayKey,
    isFuture: dayKey > todayKey,
  }));

  const found = new Map<string, MonthEntry>();
  // Days outside the month are dropped rather than placed: a caller that asks
  // too widely gets the month it asked for, not a row that silently runs over.
  for (const entry of entries) found.set(`${entry.employeeId}|${entry.dayKey}`, entry);

  const rows: MonthRow[] = people.map((person) => {
    const cells = days.map((day) => found.get(`${person.id}|${day.dayKey}`) ?? null);
    const recorded = cells.filter((cell): cell is MonthEntry => cell !== null);

    return {
      employeeId: person.id,
      name: person.name,
      active: person.active,
      cells,
      daysRecorded: recorded.length,
      // Rounded once, at the end: 0.12 + 0.33 in binary floating point is
      // 0.44999999999999996, and a payroll-adjacent screen printing that is a
      // screen nobody trusts.
      hoursLate: Math.round(recorded.reduce((total, cell) => total + cell.delayHours, 0) * 100) / 100,
    };
  });

  return { monthKey, days, rows };
}
