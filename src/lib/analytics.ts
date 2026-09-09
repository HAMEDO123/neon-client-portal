import { periodLabel } from "@/lib/payroll";

// How well a month went, per person, and what the company rule says about it.
//
// Pure arithmetic and wording only — the counting happens in
// analytics-queries.ts and the money in payroll.ts. Keeping the rule here means
// the number on the screen and the number deducted from a salary come from the
// same line of code.

/** Completion below this share of a month's tasks costs the employee. */
export const PERFORMANCE_THRESHOLD = 0.9;

/** What falling short costs, in JOD. */
export const PERFORMANCE_PENALTY = 1;

/** The kind stored on the SalaryAdjustment row; one per employee per period. */
export const PERFORMANCE_KIND = "PERFORMANCE";

export type ProgressCounts = {
  total: number;
  completed: number;
  awaitingReview: number;
  inProgress: number;
  pending: number;
  overdue: number;
  onTime: number;
};

/**
 * The share of the period's work that is finished, 0–1.
 *
 * A person with nothing assigned scores 1: there is nothing to have failed at,
 * and a new hire must not be docked for an empty board.
 */
export function progressOf(counts: Pick<ProgressCounts, "total" | "completed">) {
  if (counts.total <= 0) return 1;
  return counts.completed / counts.total;
}

/** Punctuality among the work that was actually finished, 0–1. */
export function timelinessOf(counts: Pick<ProgressCounts, "completed" | "onTime">) {
  if (counts.completed <= 0) return 1;
  return counts.onTime / counts.completed;
}

export function asPercent(ratio: number) {
  return Math.round(ratio * 100);
}

/** Whether the rule bites. Nothing assigned is never a shortfall. */
export function isShortfall(counts: ProgressCounts) {
  return counts.total > 0 && progressOf(counts) < PERFORMANCE_THRESHOLD;
}

/**
 * Why money was deducted, in the words the employee is shown. It states the
 * numbers behind the decision so the notification is checkable rather than
 * just an announcement.
 */
export function shortfallReason(period: string, counts: ProgressCounts) {
  const percent = asPercent(progressOf(counts));
  const target = asPercent(PERFORMANCE_THRESHOLD);
  return (
    `${periodLabel(period)}: you completed ${counts.completed} of ${counts.total} tasks (${percent}%), ` +
    `below the ${target}% target. ${PERFORMANCE_PENALTY.toFixed(2)} JOD has been deducted from this period's salary.`
  );
}
