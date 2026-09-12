// Checking a claim of finished work against what was actually asked for.
//
// Pure on purpose. Reading a photo is a judgement a model makes; what that
// judgement *means* is a rule, and rules belong somewhere they can be checked
// without a model, a database or a network.
//
// Two failures this exists to prevent, and they pull in opposite directions:
// accepting work because somebody said it was done, and rejecting work because
// the evidence was thin. "I cannot tell from this photo" is not "you did not do
// it", and the two must never produce the same message to a person.

/** What the evidence says about one thing that was asked for. */
export type Verdict =
  /** The evidence shows it. */
  | "met"
  /** Some of it is shown, and some is not. */
  | "partly"
  /** The evidence shows it was not done. */
  | "not-met"
  /** Nothing here settles it either way — a limit of the evidence, not of the work. */
  | "cannot-tell"
  /** A person has to look at this one. */
  | "needs-human";

export type CriterionCheck = {
  /** What was asked for, in the manager's own words. */
  required: string;
  /** What in what was sent speaks to it, described rather than asserted. */
  evidence: string | null;
  verdict: Verdict;
  /** What is missing or contradicts it. Required for anything short of met. */
  gap: string | null;
};

export type Outcome =
  | "accepted"
  | "changes-requested"
  | "clarification-required"
  | "human-review";

export type Policy = {
  /**
   * Whether this kind of work may be accepted without a person looking.
   * Off unless somebody has deliberately turned it on for a task type whose
   * criteria can actually be checked.
   */
  autoAccept: boolean;
};

export const DEFAULT_POLICY: Policy = { autoAccept: false };

/**
 * What to do with a submission, from the verdicts on each thing that was asked.
 *
 * The order is deliberate. A definite gap is worth saying before an uncertain
 * one, because it is actionable; and nothing is ever accepted on no criteria at
 * all, because "there was nothing to check" is not the same as "it passed".
 */
export function outcomeOf(checks: CriterionCheck[], policy: Policy = DEFAULT_POLICY): Outcome {
  if (checks.length === 0) return "human-review";

  if (checks.some((check) => check.verdict === "needs-human")) return "human-review";
  if (checks.some((check) => check.verdict === "not-met" || check.verdict === "partly")) {
    return "changes-requested";
  }
  if (checks.some((check) => check.verdict === "cannot-tell")) return "clarification-required";

  // Everything shown. Accepting without a person is a policy decision, never a
  // default.
  return policy.autoAccept ? "accepted" : "human-review";
}

/** The specific things to fix, never "the work is incomplete". */
export function gapsFrom(checks: CriterionCheck[]): { required: string; gap: string }[] {
  return checks
    .filter((check) => check.verdict === "not-met" || check.verdict === "partly")
    .map((check) => ({ required: check.required, gap: check.gap?.trim() || "Nothing sent shows this yet." }));
}

/** The specific things to ask about, when the evidence simply does not settle them. */
export function questionsFrom(checks: CriterionCheck[]): { required: string; question: string }[] {
  return checks
    .filter((check) => check.verdict === "cannot-tell")
    .map((check) => ({
      required: check.required,
      question: check.gap?.trim() || "Send something that shows this part.",
    }));
}

/** What the outcome is called where a person reads it. */
export function describeOutcome(outcome: Outcome): string {
  switch (outcome) {
    case "accepted":
      return "Accepted";
    case "changes-requested":
      return "Changes requested";
    case "clarification-required":
      return "More detail needed";
    case "human-review":
      return "Waiting for the manager";
  }
}

/**
 * Whether an outcome is one the platform may act on by itself.
 *
 * Only acceptance is ever automatic, and only under a policy that says so.
 * Everything else ends with a person — which is the point.
 */
export function isAutomatic(outcome: Outcome, policy: Policy = DEFAULT_POLICY): boolean {
  return outcome === "accepted" && policy.autoAccept;
}

/**
 * Submitting work never finishes it.
 *
 * Written as a function rather than left implicit, because it is the rule the
 * whole feature exists to protect: a claim is the beginning of a check, not the
 * end of one.
 */
export function submissionClosesTask(): false {
  return false;
}

/**
 * A re-submission is checked against what is still open, not from scratch.
 *
 * The notes that were already answered stay answered; anything the manager
 * raised and nobody has addressed is carried forward, so an employee is never
 * asked twice for the same thing.
 */
export function stillOpen(previous: CriterionCheck[], latest: CriterionCheck[]): CriterionCheck[] {
  const settled = new Set(
    latest.filter((check) => check.verdict === "met").map((check) => check.required.trim().toLowerCase())
  );

  return previous.filter(
    (check) =>
      check.verdict !== "met" && !settled.has(check.required.trim().toLowerCase())
  );
}
