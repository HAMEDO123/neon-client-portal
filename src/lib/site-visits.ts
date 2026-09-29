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
  /** Null when nobody has set a date yet — see `needsDate`. */
  scheduledAt: Date | string | null;
};

function at(value: Date | string | null): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Nobody has said when yet.
 *
 * The manager writes a visit down — this client, this site — and leaves the
 * when to whoever is going, because they know their own week. A visit like
 * this is **not** overdue and **not** upcoming: both of those are claims about
 * a date, and there is no date. Saying it plainly is the point; a blank date
 * shown as "today" or sorted as though it were long past would invent one.
 */
export function needsDate(visit: VisitLike): boolean {
  return visit.state === "PLANNED" && at(visit.scheduledAt) == null;
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
  const when = at(visit.scheduledAt);
  // No date is not a date in the past. A visit nobody has scheduled cannot be
  // late for itself.
  return visit.state === "PLANNED" && when != null && when <= now;
}

/** Still ahead: planned, and not yet due. */
export function isUpcoming(visit: VisitLike, now: number = Date.now()): boolean {
  const when = at(visit.scheduledAt);
  return visit.state === "PLANNED" && when != null && when > now;
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
    awaitingApproval(visit)
      ? 0
      : awaitingReport(visit, now)
        ? 1
        : needsDate(visit)
          ? 2
          : isUpcoming(visit, now)
            ? 3
            : 4;

  return [...visits].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;

    // A visit with no date has nothing to sort by, so it keeps the order it
    // arrived in rather than being placed by a number that does not exist.
    const first = at(a.scheduledAt);
    const second = at(b.scheduledAt);
    if (first == null || second == null) return 0;

    // Waiting and unanswered: the oldest has waited longest. Upcoming: the
    // soonest is next. Settled: the most recent is the most interesting.
    if (rank(a) === 4) return second - first;
    return first - second;
  });
}
