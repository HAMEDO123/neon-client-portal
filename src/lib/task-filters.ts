// Which of somebody's tasks a list is showing.
//
// The list had three answers — open, completed, all — and "open" was one
// bucket holding work nobody had started, work under way, work waiting on the
// manager and work that was late, which are four different things to do next.
// The studio asked for them apart.
//
// Pure, because "late" decides what somebody is told they are behind on, and
// because both sides read it: the team's own list and the manager's week.

export const TASK_FILTERS = ["open", "progress", "review", "late", "done", "all"] as const;
export type TaskFilter = (typeof TASK_FILTERS)[number];

type State = "TODO" | "IN_PROGRESS" | "SUBMITTED" | "DONE" | "TOMORROW";

/** What a list needs to know about one task to place it. */
export type Filterable = { state: State; late: boolean };

/**
 * The filter a URL names. Anything unreadable is the fallback rather than an
 * empty list, and `completed` — what "done" was called until now — still
 * means it, for a page somebody left open or bookmarked.
 */
export function readTaskFilter(value: unknown, fallback: TaskFilter = "open"): TaskFilter {
  if (value === "completed") return "done";
  return (TASK_FILTERS as readonly unknown[]).includes(value) ? (value as TaskFilter) : fallback;
}

/**
 * Late: the day it was due has gone and it has not been approved.
 *
 * The same reading as the countdown on the card, on purpose — whole days in
 * the studio's calendar, so something due today is not late however late in
 * the day it is — and the card says "2 days late" on exactly the tasks this
 * filter lists. Work sent for review still counts: it is late until somebody
 * approves it, which is what the card goes on saying about it too. Work with
 * no date cannot be late.
 */
export function isLate(state: State, dueDayKey: string | null | undefined, todayKey: string) {
  if (state === "DONE" || !dueDayKey) return false;
  return dueDayKey < todayKey;
}

export function matchesFilter(item: Filterable, filter: TaskFilter) {
  switch (filter) {
    case "all":
      return true;
    case "open":
      return item.state !== "DONE";
    case "progress":
      return item.state === "IN_PROGRESS";
    case "review":
      return item.state === "SUBMITTED";
    case "late":
      return item.late;
    case "done":
      return item.state === "DONE";
  }
}

/** How many tasks each filter would show, for the number on its button. */
export function countByFilter(items: readonly Filterable[]): Record<TaskFilter, number> {
  const counts = { open: 0, progress: 0, review: 0, late: 0, done: 0, all: 0 };
  for (const item of items) {
    for (const filter of TASK_FILTERS) {
      if (matchesFilter(item, filter)) counts[filter] += 1;
    }
  }
  return counts;
}
