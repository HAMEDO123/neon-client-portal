import { periodOf, periodRange, previousPeriod } from "@/lib/payroll";
import { countStates, percentDone } from "@/lib/progress";
import { dateToDayKey, shiftDayKey } from "@/lib/time";
import { weekStartKey } from "@/lib/week";

// What the "Team" segment of the manager's Tasks tab counts: for each person,
// how much of the work they were given over a week or a month is finished.
//
// Pure — no database and no clock of its own — so the tests pin it. The query
// that feeds it is tasks-people.ts.
//
// Nothing here is a new rule. States are sorted by `countStates` and the
// percentage is `percentDone`, both lib/progress.ts: the analytics page's own
// arithmetic. "Done" is DONE — the manager approved it — and SUBMITTED is work
// sent for review, which is not done until the manager says so.

export const PEOPLE_PERIODS = ["week", "month"] as const;
export type PeoplePeriod = (typeof PEOPLE_PERIODS)[number];

export type PeriodWindow = {
  /** First and last day of the period, inclusive, as the studio's day keys. */
  from: string;
  to: string;
  /** A day inside the period before and the period after, for moving between them. */
  previous: string;
  next: string;
};

/**
 * The days a period covers around `anchorKey`.
 *
 * A week is the assignment board's week (lib/week.ts), Sunday to Saturday. A
 * month is the payroll month (`periodOf`/`periodRange` in lib/payroll.ts) — the
 * same window the analytics page's monthly figure is counted over.
 */
export function periodWindow(period: PeoplePeriod, anchorKey: string): PeriodWindow {
  if (period === "week") {
    const from = weekStartKey(anchorKey);
    return { from, to: shiftDayKey(from, 6), previous: shiftDayKey(from, -7), next: shiftDayKey(from, 7) };
  }

  const month = periodOf(anchorKey);
  const { start, end } = periodRange(month);
  const from = dateToDayKey(start)!;
  const next = dateToDayKey(end)!;
  return { from, to: shiftDayKey(next, -1), previous: `${previousPeriod(month)}-01`, next };
}

/**
 * Done over given, as a whole percentage — or null when nothing was given.
 *
 * The number is the one the website prints on /admin/analytics: `percentDone`
 * (lib/progress.ts) for a person's day, and `asPercent(progressOf(counts))`
 * (lib/analytics.ts) for their month, which round the same fraction the same
 * way. Where the website prints "—" for an empty period, this is null, never
 * 0: nothing given is not a failure, and silence is never a verdict.
 */
export function completionPercent(counts: { done: number; total: number }): number | null {
  return counts.total > 0 ? percentDone(counts) : null;
}

// Handed in and waiting on the manager, or approved: either way the person's
// part is finished, so it is not late on them. The analytics page's live
// "Late" figure (getEmployeeProgress) leaves out the same two.
const OUT_OF_THEIR_HANDS = new Set(["DONE", "SUBMITTED"]);

/** A board cell is late once its deadline — typed, or from the stage periods — has passed. */
export function cellOverdue(state: string, deadline: Date | null, now: Date) {
  return deadline !== null && deadline.getTime() < now.getTime() && !OUT_OF_THEIR_HANDS.has(state);
}

/**
 * A job runs to the end of its last day, which is a calendar question where
 * the studio is (`countdownToDay` in lib/stage-schedule.ts): late from the day
 * after, not from some hour of the last one.
 */
export function jobOverdue(state: string, endKey: string, todayKey: string) {
  return endKey < todayKey && !OUT_OF_THEIR_HANDS.has(state);
}

export type CountedItem = { kind: "cell" | "job"; state: string; overdue: boolean };

/** One person's period, by where each piece of it stands. */
export function tallyWork(items: CountedItem[]) {
  const counts = countStates(items.map((item) => item.state));
  const cells = items.filter((item) => item.kind === "cell");
  const jobs = items.filter((item) => item.kind === "job");
  const doneIn = (list: CountedItem[]) => list.filter((item) => item.state === "DONE").length;

  return {
    total: counts.total,
    done: counts.done,
    submitted: counts.review,
    inProgress: counts.working,
    // TODO, and TOMORROW, which is still work waiting.
    todo: counts.pending,
    overdue: items.filter((item) => item.overdue).length,
    percent: completionPercent(counts),
    boardCells: { total: cells.length, done: doneIn(cells) },
    jobs: { total: jobs.length, done: doneIn(jobs) },
  };
}

type Sortable = CountedItem & { dueDay: string | null; scheduledFor: string | null; startDay: string | null };

function rank(item: Sortable) {
  if (item.overdue) return 0;
  if (item.state === "SUBMITTED") return 2;
  if (item.state === "DONE") return 3;
  return 1;
}

/**
 * The list the manager reads: what is late first, then what is still open,
 * then what waits on their review, then what is finished — each soonest first,
 * with undated work at the end of its group.
 */
export function sortItems<T extends Sortable>(items: T[]): T[] {
  const dayOf = (item: T) => item.dueDay ?? item.scheduledFor ?? item.startDay ?? "9999-12-31";
  return [...items].sort((a, b) => rank(a) - rank(b) || dayOf(a).localeCompare(dayOf(b)));
}
