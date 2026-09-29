// The arithmetic behind the Home tab's small charts, with no database in it,
// so it can be tested on its own (tests/home-pulse.test.ts).
//
// Every series here is counted from a timestamp the platform really records —
// when a project was created, when an approval was answered, when a task was
// marked done, the day a project was sold. A figure with no such record behind
// it is not drawn at all rather than estimated: that decision is made by the
// caller (home-pulse.ts), and nothing here fills a gap with a guess.

/** Days in a YYYY-MM month. */
export function daysInMonth(period: string) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The week of the month a day falls in, counted from the 1st: days 1–7 are
 * week 1, 8–14 week 2, and so on, so the 29th–31st are a short week 5. Weeks
 * of the month rather than calendar weeks, so this month and last month line
 * up bar for bar.
 */
export function weekOfMonth(day: number) {
  return Math.floor((day - 1) / 7) + 1;
}

/** How many weeks (as `weekOfMonth` counts them) a month has: 4 or 5. */
export function weeksInMonth(period: string) {
  return Math.ceil(daysInMonth(period) / 7);
}

/** Counts day keys (YYYY-MM-DD) into the weeks of `period`; other months are ignored. */
export function weeklyCounts(dayKeys: readonly string[], period: string): number[] {
  const weeks: number[] = new Array(weeksInMonth(period)).fill(0);
  for (const key of dayKeys) {
    if (key.slice(0, 7) !== period) continue;
    const day = Number(key.slice(8, 10));
    if (!Number.isInteger(day) || day < 1) continue;
    weeks[Math.min(weeks.length, weekOfMonth(day)) - 1] += 1;
  }
  return weeks;
}

/** How many day keys fall in `period` on or before its day `throughDay`. */
export function countThrough(dayKeys: readonly string[], period: string, throughDay: number) {
  let count = 0;
  for (const key of dayKeys) {
    if (key.slice(0, 7) === period && Number(key.slice(8, 10)) <= throughDay) count += 1;
  }
  return count;
}

/** How many things had been created by each moment (created at or before it). */
export function existedAt(created: readonly Date[], moments: readonly Date[]): number[] {
  return moments.map((moment) => created.filter((at) => at.getTime() <= moment.getTime()).length);
}

/**
 * How many spans were open at each moment: begun at or before it, and not yet
 * closed — a span with no end is still open. An approval is open from the
 * moment it is asked for until the client answers it.
 */
export function openAt(spans: readonly { from: Date; to: Date | null }[], moments: readonly Date[]): number[] {
  return moments.map((moment) => {
    const t = moment.getTime();
    return spans.filter((span) => span.from.getTime() <= t && (span.to === null || span.to.getTime() > t)).length;
  });
}

/** The YYYY-MM month `offset` months from `period` (negative goes back). */
export function shiftPeriod(period: string, offset: number) {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * One metric of the "This month" card: this month's weeks against last
 * month's, and this month so far against the same days of last month — the
 * only honest comparison while a month is still running.
 */
export type MonthSeries = {
  period: string;
  previousPeriod: string;
  /** Day of the month today is; this month is counted through it. */
  throughDay: number;
  weeks: number[];
  previousWeeks: number[];
  total: number;
  /** Last month's count through the same day of the month (its last day, if shorter). */
  previousToDate: number;
  previousTotal: number;
};

export function monthSeries(dayKeys: readonly string[], today: string): MonthSeries {
  const period = today.slice(0, 7);
  const previousPeriod = shiftPeriod(period, -1);
  const throughDay = Number(today.slice(8, 10));
  const previousThrough = Math.min(throughDay, daysInMonth(previousPeriod));
  return {
    period,
    previousPeriod,
    throughDay,
    weeks: weeklyCounts(dayKeys, period),
    previousWeeks: weeklyCounts(dayKeys, previousPeriod),
    total: countThrough(dayKeys, period, throughDay),
    previousToDate: countThrough(dayKeys, previousPeriod, previousThrough),
    previousTotal: countThrough(dayKeys, previousPeriod, 31),
  };
}
