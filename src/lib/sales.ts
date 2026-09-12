// The monthly sales target: how many projects someone is expected to sell in a
// calendar month, and where they stand against it.
//
// A project is the sale. The manager records who sold it and the day it counts
// for on the project's own page, and the month that day falls in is the month
// it counts towards. Each person's target is their own; three is the default.

export const DEFAULT_SALES_TARGET = 3;

export type SalesStanding = {
  sold: number;
  target: number;
  /** Still to sell this month. Zero once the target is met. */
  left: number;
  met: boolean;
  /** How full the bar is, 0–100. */
  percent: number;
};

export function salesStanding(sold: number, target: number): SalesStanding {
  const safeSold = Math.max(0, Math.floor(sold));
  const safeTarget = Math.max(0, Math.floor(target));

  return {
    sold: safeSold,
    target: safeTarget,
    left: Math.max(0, safeTarget - safeSold),
    // Nothing to chase is nothing to fall short of.
    met: safeTarget === 0 || safeSold >= safeTarget,
    percent: safeTarget === 0 ? 100 : Math.min(100, Math.round((safeSold / safeTarget) * 100)),
  };
}

/** The line under the bar: what is left, or that the target is met. */
export function salesLine(standing: SalesStanding) {
  if (standing.target === 0) return "No target set.";
  if (standing.sold > standing.target) return `Target met, ${standing.sold - standing.target} over.`;
  if (standing.met) return "Target met.";
  return `${standing.left} more to reach the target.`;
}
