import { dayKeyToDate, shiftDayKey } from "@/lib/time";
import { monthDayKeys } from "@/lib/attendance-month";

// The pay week, for the people this studio settles with weekly.
//
// It starts on **Tuesday**, which is the studio's own arrangement and nothing
// to do with the assignment board's week (lib/week.ts starts on Sunday, so the
// working week reads left to right). Two different questions: one is how work
// is laid out, this one is when somebody is paid.
//
// Why it has to exist at all: a weekly salary charged a whole month of
// deductions is the wrong sum. The pay sheet reads a month at a time, and for
// somebody on 75 JOD a week that meant four weeks of lateness and cutoffs
// taken off one week's pay — a figure that could only ever be too large, and
// was never the week anybody was actually being paid for.
//
// Day keys throughout, like week.ts: which week a day falls in is a calendar
// question in the studio's timezone, never a question about the server's clock.

/** Tuesday. The day a weekly person's pay rolls over. */
export const PAY_WEEK_START_DAY = 2;

const DAYS_IN_WEEK = 7;

export type PayWeek = {
  /** The Tuesday it starts on. */
  startKey: string;
  /** The Monday it ends on. */
  endKey: string;
  /** Stable id for a row or a React key: the start day. */
  key: string;
  /** "Tue 6 – Mon 12 Oct", for somebody reading the pay sheet. */
  label: string;
};

/** The Tuesday on or before this day. */
export function payWeekStartKey(dayKey: string): string {
  const offset = (dayKeyToDate(dayKey).getUTCDay() - PAY_WEEK_START_DAY + DAYS_IN_WEEK) % DAYS_IN_WEEK;
  return shiftDayKey(dayKey, -offset);
}

/** The pay week a day falls in. */
export function payWeekOf(dayKey: string): PayWeek {
  const startKey = payWeekStartKey(dayKey);
  const endKey = shiftDayKey(startKey, DAYS_IN_WEEK - 1);
  return { startKey, endKey, key: startKey, label: payWeekLabel(startKey, endKey) };
}

/**
 * Every pay week of a month.
 *
 * A week belongs to the month its **Tuesday** falls in, so a week is never cut
 * in half: a week is what somebody is paid for, and half a week's deductions
 * against a whole week's salary would be the same mistake in miniature.
 *
 * The consequence, said plainly because it will be noticed: the first days of
 * a month can belong to the previous month's last week. 1–5 October 2026 are
 * part of the week that began Tuesday 29 September, and they appear under
 * September. Every week is shown with its own dates for exactly that reason,
 * and no day is ever counted in two months.
 */
export function payWeeksInMonth(monthKey: string): PayWeek[] {
  const weeks: PayWeek[] = [];
  for (const dayKey of monthDayKeys(monthKey)) {
    if (dayKeyToDate(dayKey).getUTCDay() !== PAY_WEEK_START_DAY) continue;
    weeks.push(payWeekOf(dayKey));
  }
  return weeks;
}

/** Whether a day is in this week. */
export function inPayWeek(week: PayWeek, dayKey: string): boolean {
  return dayKey >= week.startKey && dayKey <= week.endKey;
}

/** The first and last day a set of weeks covers, for one query over all of them. */
export function payWeekSpan(weeks: PayWeek[]): { fromKey: string; toKey: string } | null {
  if (weeks.length === 0) return null;
  return { fromKey: weeks[0].startKey, toKey: weeks[weeks.length - 1].endKey };
}

/**
 * "Tue 6 – Mon 12 Oct", and "Tue 27 Oct – Mon 2 Nov" where it crosses a month.
 *
 * Formatted in UTC on purpose: a day key is a calendar date, not an instant,
 * and putting one through a timezone is how a Tuesday prints as a Monday.
 */
function payWeekLabel(startKey: string, endKey: string): string {
  const crossesMonth = startKey.slice(0, 7) !== endKey.slice(0, 7);
  return `${format(startKey, crossesMonth)} – ${format(endKey, true)}`;
}

function format(dayKey: string, withMonth: boolean): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    ...(withMonth ? { month: "short" } : {}),
  })
    .format(dayKeyToDate(dayKey))
    // en-GB gives "Tue 6 Oct"; the comma it inserts without a month ("Tue, 6")
    // is the only difference between the two shapes.
    .replace(",", "");
}

/**
 * The stretches of days one person's pay is settled in, over a month.
 *
 * A monthly salary is one stretch: the month, exactly as the pay sheet always
 * read it. A weekly one is a stretch per pay week, so each week carries its
 * own lateness, its own cutoffs and its own receipts.
 *
 * Weeks that have not begun are left out. A week nobody has worked a day of is
 * not payable yet, and a pay sheet that lists it has invented a figure — the
 * same refusal the month sheet makes about days still to come.
 */
export function paySlices(
  basis: "MONTHLY" | "WEEKLY",
  monthKey: string,
  todayKey: string
): { fromKey: string; toKey: string; week: PayWeek | null }[] {
  if (basis !== "WEEKLY") {
    const days = monthDayKeys(monthKey);
    return [{ fromKey: days[0], toKey: days[days.length - 1], week: null }];
  }

  return payWeeksInMonth(monthKey)
    .filter((week) => week.startKey <= todayKey)
    .map((week) => ({ fromKey: week.startKey, toKey: week.endKey, week }));
}
