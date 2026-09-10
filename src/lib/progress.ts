import { daysBetween } from "@/lib/week";

// How far through its time a task is, and how the day's work adds up.
//
// A countdown says how much is left; a bar shows how much has gone, which is
// the thing you take in at a glance. Counted in calendar days, like the
// countdown, so the two never disagree. Pure — the components draw it, the
// tests pin it.

export type DayWindow = {
  /** Which day of the window today is: 0 before it starts, capped at `total`. */
  day: number;
  total: number;
  /** Days past the last one. */
  over: number;
  /** Days until the first one, when it has not started. */
  startsIn: number;
};

export function dayOfWindow(startKey: string, endKey: string, todayKey: string): DayWindow {
  // A window written backwards is the same window.
  const [from, to] = daysBetween(startKey, endKey) >= 0 ? [startKey, endKey] : [endKey, startKey];
  const total = daysBetween(from, to) + 1;
  const raw = daysBetween(from, todayKey) + 1;

  return {
    day: Math.min(Math.max(raw, 0), total),
    total,
    over: Math.max(0, raw - total),
    startsIn: Math.max(0, 1 - raw),
  };
}

/** How full the bar is: empty before the first day, full on the last and after. */
export function windowFraction(window: Pick<DayWindow, "day" | "total">) {
  if (window.total <= 0) return 0;
  return Math.min(1, Math.max(0, window.day / window.total));
}

/** The words under the bar. */
export function windowLabel(window: DayWindow) {
  if (window.startsIn > 0) return window.startsIn === 1 ? "Starts tomorrow" : `Starts in ${window.startsIn} days`;
  if (window.over > 0) return window.over === 1 ? "1 day over" : `${window.over} days over`;
  return `Day ${window.day} of ${window.total}`;
}

export type StateCounts = { done: number; review: number; working: number; pending: number; total: number };

/** A day's tasks by where they stand. TOMORROW is still work waiting, so it is pending. */
export function countStates(states: string[]): StateCounts {
  const counts: StateCounts = { done: 0, review: 0, working: 0, pending: 0, total: states.length };
  for (const state of states) {
    if (state === "DONE") counts.done += 1;
    else if (state === "SUBMITTED") counts.review += 1;
    else if (state === "IN_PROGRESS") counts.working += 1;
    else counts.pending += 1;
  }
  return counts;
}

export function percentDone(counts: Pick<StateCounts, "done" | "total">) {
  return counts.total === 0 ? 0 : Math.round((counts.done / counts.total) * 100);
}
