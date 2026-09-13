// How somebody's work is going, measured by what came out of it.
//
// Pure on purpose, and deliberately short. Five indicators, all about the
// output: whether work landed by the date it was given, whether it was accepted
// the first time it was sent, how often it came back, how long it sat waiting
// on somebody else, and how close the estimates were.
//
// What is not measured here, and will not be: presence, hours at a desk, how
// fast somebody replies, how many times they tapped something. None of those is
// the work, and a number that stands in for the work is worse than no number.
//
// The rule that matters most: a number is refused rather than guessed. One late
// task is not "0% on time", so every indicator carries the sample it came from
// and returns nothing at all below a threshold — the screen cannot then show a
// figure that reads like a verdict.

/** Below this many measurements, no percentage is reported at all. */
export const MIN_SAMPLE = 3;

export type Indicator = {
  /** The number, or null when there is not enough to say. */
  value: number | null;
  /** How many measurements it came from. */
  sample: number;
  /** Why there is no number, in words worth showing. */
  why: string | null;
};

const notEnough = (sample: number, what: string): Indicator => ({
  value: null,
  sample,
  why:
    sample === 0
      ? `Nothing to measure yet — no ${what}.`
      : `Only ${sample} so far; a number would say more than the work does.`,
});

function percentage(hits: number, total: number): number {
  return Math.round((hits / total) * 100);
}

// --- What was delivered, against the date it was given ----------------------

export type DeliveryFact = {
  /** Whether it was finished by its deadline. Null when it never had one. */
  onTime: boolean | null;
};

/**
 * Of the work that had a deadline, how much landed on time.
 *
 * Work with no deadline is left out rather than counted as on time: nobody
 * agreed a date, so there is nothing to have met.
 */
export function deliveryAdherence(facts: DeliveryFact[]): Indicator {
  const dated = facts.filter((fact) => fact.onTime !== null);
  if (dated.length < MIN_SAMPLE) return notEnough(dated.length, "deadlines yet");

  return {
    value: percentage(dated.filter((fact) => fact.onTime).length, dated.length),
    sample: dated.length,
    why: null,
  };
}

// --- What the review made of it --------------------------------------------

export type ReviewFact = {
  /** Accepted the first time it was sent. */
  acceptedFirstTime: boolean;
  /** How many times it was sent back before it was accepted. */
  sendBacks: number;
};

/** Of the work that was reviewed, how much was accepted the first time. */
export function firstReviewAcceptance(facts: ReviewFact[]): Indicator {
  if (facts.length < MIN_SAMPLE) return notEnough(facts.length, "reviews yet");

  return {
    value: percentage(facts.filter((fact) => fact.acceptedFirstTime).length, facts.length),
    sample: facts.length,
    why: null,
  };
}

/**
 * How often work comes back, as send-backs per reviewed piece.
 *
 * A rate rather than a count, so somebody who does more work is not made to
 * look worse for it.
 */
export function reworkRate(facts: ReviewFact[]): Indicator {
  if (facts.length < MIN_SAMPLE) return notEnough(facts.length, "reviews yet");

  const total = facts.reduce((sum, fact) => sum + Math.max(0, fact.sendBacks), 0);
  return { value: Math.round((total / facts.length) * 100) / 100, sample: facts.length, why: null };
}

// --- Time lost waiting on somebody else ------------------------------------

export type BlockedFact = { minutesWaiting: number };

/**
 * Minutes spent unable to proceed.
 *
 * Reported from the first measurement, because this is not a judgement about
 * the person — it is a number about the studio, and one long block is worth
 * seeing on its own.
 */
export function waitingOnBlockers(facts: BlockedFact[]): Indicator {
  const total = facts.reduce((sum, fact) => sum + Math.max(0, fact.minutesWaiting), 0);
  return { value: facts.length === 0 ? null : total, sample: facts.length, why: facts.length ? null : "Nothing has been blocked." };
}

// --- How close the estimates were ------------------------------------------

export type EstimateFact = { estimatedMinutes: number; actualMinutes: number };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * How long work actually took against what it was expected to take, as a
 * median ratio: 1 is on the nose, 1.5 is half again as long.
 *
 * The median rather than the mean, so one afternoon that went badly does not
 * define somebody's estimating.
 */
export function estimateAccuracy(facts: EstimateFact[]): Indicator {
  const usable = facts.filter((fact) => fact.estimatedMinutes > 0 && fact.actualMinutes > 0);
  if (usable.length < MIN_SAMPLE) return notEnough(usable.length, "estimates to compare yet");

  const ratios = usable.map((fact) => fact.actualMinutes / fact.estimatedMinutes);
  return { value: Math.round(median(ratios) * 100) / 100, sample: usable.length, why: null };
}

/** How an estimate ratio reads to a person. */
export function describeEstimate(ratio: number | null): string {
  if (ratio === null) return "Not enough to say";
  if (ratio <= 1.1 && ratio >= 0.9) return "About right";
  if (ratio > 1.1) return `Takes about ${ratio.toFixed(1)}× the estimate`;
  return `Finishes in about ${ratio.toFixed(1)}× the estimate`;
}
