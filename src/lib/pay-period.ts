// What a "month" means in this platform.
//
// **The studio settles from the 5th to the 4th**, not from the 1st to the end
// of the calendar month. It always has — the owner's words on 2026-11-03 were
// "كانت احنا بنحاسب من 5 الشهر ل5 الشهر" — but the platform read a calendar
// month everywhere, and the two only looked the same until somebody opened the
// pay sheet on the 3rd of a month and found it nearly empty: four days of work
// filed under a month that had barely begun, while the month they were being
// paid for sat behind "Previous month" and looked finished.
//
// So a period is still named `YYYY-MM` — the month it *starts* in — and every
// stored `periodMonth`, every URL and every saved row keeps working. What
// changed is where it begins and ends. October 2026 is **5 October to 4
// November**. The 5th of a month is always the first day of a new period, and
// no day belongs to two periods.
//
// Everything that asks "which period is this day in" or "which days are in
// this period" comes here, so the answer cannot differ between the pay sheet,
// the attendance grid, the receipts and the phone. The day it starts on is a
// constant rather than a 5 scattered through the arithmetic, because the one
// thing worse than the wrong boundary is two of them.

/** The day of the month a period starts on. The studio settles 5th to 4th. */
export const PERIOD_START_DAY = 5;

const MONTH_KEY = /^\d{4}-\d{2}$/;

function monthKeyOf(year: number, monthIndex: number): string {
  // Date.UTC normalises an out-of-range month, so December + 1 rolls the year
  // without a special case.
  const moved = new Date(Date.UTC(year, monthIndex, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The period after this one, as YYYY-MM. */
export function nextPeriod(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return monthKeyOf(year, month);
}

/** The period before this one, as YYYY-MM. */
export function priorPeriod(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return monthKeyOf(year, month - 2);
}

/**
 * The pay period a date belongs to, as YYYY-MM.
 *
 * The 1st to the 4th belong to the period that started last month: 3 November
 * is in October's pay. This is the function the mistake lived in — it was
 * `dayKey.slice(0, 7)`, which is the calendar month and was never what the
 * studio settles by.
 */
export function periodOf(dayKey: string): string {
  const month = dayKey.slice(0, 7);
  const day = Number(dayKey.slice(8, 10));
  return day >= PERIOD_START_DAY ? month : priorPeriod(month);
}

/** The first day of a period: the 5th of the month it is named after. */
export function periodFirstDayKey(period: string): string {
  return `${period}-${String(PERIOD_START_DAY).padStart(2, "0")}`;
}

/** The last day of a period: the 4th of the month after it. */
export function periodLastDayKey(period: string): string {
  return `${nextPeriod(period)}-${String(PERIOD_START_DAY - 1).padStart(2, "0")}`;
}

/**
 * Every day of a period, in order — the 5th of one month to the 4th of the
 * next.
 *
 * Built by walking real UTC dates rather than by counting, so February, a leap
 * year and a year boundary all come out right without a rule for any of them.
 */
export function periodDayKeys(period: string): string[] {
  if (!MONTH_KEY.test(period)) return [];

  const [year, month] = period.split("-").map(Number);
  const start = Date.UTC(year, month - 1, PERIOD_START_DAY);
  const end = Date.UTC(year, month, PERIOD_START_DAY); // exclusive: next period's first day

  const keys: string[] = [];
  for (let at = start; at < end; at += 24 * 60 * 60 * 1000) {
    keys.push(new Date(at).toISOString().slice(0, 10));
  }
  return keys;
}

/** The first and last day of a period, for a query over `@db.Date` columns. */
export function periodBounds(period: string): { from: string; to: string } {
  return { from: periodFirstDayKey(period), to: periodLastDayKey(period) };
}

/**
 * "5 Oct – 4 Nov 2026": the dates a period actually covers.
 *
 * Shown beside the month's name wherever a period is named, because "October"
 * on its own is what made a 5th-to-4th period read as a calendar one. Formatted
 * in UTC: a day key is a calendar date, not an instant, and putting one through
 * a timezone is how the 5th prints as the 4th.
 */
export function periodRangeLabel(period: string): string {
  const from = periodFirstDayKey(period);
  const to = periodLastDayKey(period);
  const day = (dayKey: string, withYear: boolean) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
    }).format(new Date(`${dayKey}T00:00:00Z`));

  return `${day(from, false)} – ${day(to, true)}`;
}
