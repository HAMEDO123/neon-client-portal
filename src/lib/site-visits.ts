import type { SiteVisitState } from "@/generated/prisma/enums";

// What a site visit is, and where it stands.
//
// Pure, and tested, because the one judgement here is the one the manager
// actually opens the screen for: a visit whose time has come and gone with
// nothing written against it. Everything else is labels and ordering.
//
// The platform never decides that a visit happened. PLANNED means somebody
// wrote it down; VISITED and MISSED are a person saying so afterwards. A
// planned visit in the past is therefore "not answered yet" and is said in
// exactly those words — it is not evidence that nobody went, and the screen
// must never read as though it were.

export const VISIT_STATES = ["PLANNED", "REPORTED", "VISITED", "MISSED", "CANCELLED"] as const;

export const STATE_LABEL: Record<SiteVisitState, string> = {
  PLANNED: "Planned",
  REPORTED: "Waiting for the manager",
  VISITED: "Done",
  MISSED: "Did not go",
  CANCELLED: "Called off",
};

/** The tone each state is drawn in, so the two portals cannot disagree. */
export const STATE_TONE: Record<SiteVisitState, string> = {
  PLANNED: "bg-cyan/10 text-cyan-strong",
  REPORTED: "bg-amber-500/10 text-amber-700",
  VISITED: "bg-emerald-500/10 text-emerald-700",
  MISSED: "bg-pink-strong/10 text-pink-strong",
  CANCELLED: "bg-ink/8 text-ink/45",
};

export type VisitLike = {
  state: SiteVisitState;
  scheduledAt: Date | string;
};

function at(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * Whether this visit is still to be answered: planned, and its time has
 * passed.
 *
 * This is the whole reason the plan and the answer live on one row. A visit
 * nobody wrote up is invisible if the two are kept apart — there is no list of
 * "reports that did not arrive", only reports that did.
 */
export function awaitingReport(visit: VisitLike, now: number = Date.now()): boolean {
  return visit.state === "PLANNED" && at(visit.scheduledAt) <= now;
}

/** Still ahead: planned, and not yet due. */
export function isUpcoming(visit: VisitLike, now: number = Date.now()): boolean {
  return visit.state === "PLANNED" && at(visit.scheduledAt) > now;
}

/**
 * Whether a report is required to move to this state.
 *
 * Going and coming back with nothing written is the failure this exists to
 * prevent — "I went" on its own tells the manager less than the plan already
 * did. Not going needs a reason for the same reason.
 *
 * `VISITED` is not in the list because nobody writes it: it is what the
 * manager's approval turns a REPORTED visit into, and the words were written
 * at the REPORTED step.
 */
export function needsReport(state: SiteVisitState): boolean {
  return state === "REPORTED" || state === "MISSED";
}

/**
 * Waiting on the manager: somebody says the visit is finished and has written
 * it up, and nobody has agreed yet.
 *
 * The studio's rule, and the same one the board keeps about finished work: a
 * person who did the thing says so, and the person paying for it decides
 * whether it is done. Here the manager has one more thing to judge by than
 * the report — the client's own answer, asked for at this moment.
 */
export function awaitingApproval(visit: VisitLike): boolean {
  return visit.state === "REPORTED";
}

/**
 * The manager's order: what has gone unanswered first, then what is coming up
 * soonest, then everything settled, newest first.
 *
 * Deliberately not "newest first" throughout. The thing worth acting on is a
 * visit that was supposed to happen and has not been written up, and sorting
 * by date alone buries it under whatever was scheduled afterwards.
 */
export function sortForManager<T extends VisitLike>(visits: T[], now: number = Date.now()): T[] {
  // Anything the manager has to answer comes first — a visit written up and
  // waiting on them, then one nobody has written up at all. Both are work
  // they hold; the rest is a record.
  const rank = (visit: T) =>
    awaitingApproval(visit) ? 0 : awaitingReport(visit, now) ? 1 : isUpcoming(visit, now) ? 2 : 3;

  return [...visits].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    // Waiting and unanswered: the oldest has waited longest. Upcoming: the
    // soonest is next. Settled: the most recent is the most interesting.
    if (rank(a) === 3) return at(b.scheduledAt) - at(a.scheduledAt);
    return at(a.scheduledAt) - at(b.scheduledAt);
  });
}
