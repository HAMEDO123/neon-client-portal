import type { SiteVisitState } from "@/generated/prisma/enums";
import { dayKeyIn, formatDayIn, formatTimeIn, instantAt, shiftDayKey } from "./time";

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

// ---------------------------------------------------------------------------
// When it is

/**
 * Reads the "when" a form sent.
 *
 * Two shapes arrive and they mean different things. The phone app sends an
 * instant (`2026-10-05T11:29:00Z`); the website's date box sends a wall clock
 * with no zone (`2026-10-05T14:29`), and that is a statement about the studio,
 * not about the server. The server runs in UTC, so reading it with `new Date`
 * put every visit written on the website three hours late — and moved it three
 * hours further on every edit. Nothing looked wrong on the screen that wrote
 * it, because the same mistake was undone on the way back out.
 *
 * `ok: false` is a date somebody typed that cannot be read. Empty is allowed
 * and means nobody has picked a day yet.
 */
export function readVisitWhen(raw: string, timeZone: string): { ok: boolean; at: Date | null } {
  const text = raw.trim();
  if (!text) return { ok: true, at: null };

  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const at = new Date(text);
    return Number.isNaN(at.getTime()) ? { ok: false, at: null } : { ok: true, at };
  }

  const wall = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(text);
  if (!wall) return { ok: false, at: null };
  const at = instantAt(wall[1], wall[2], timeZone);
  return at ? { ok: true, at } : { ok: false, at: null };
}

// ---------------------------------------------------------------------------
// The visit among the tasks
//
// A visit with a day is also a job on that day — an ordinary AssignedTask, so
// the person's task list, the week board and the phone app show it without any
// of them learning a new kind of work (the same choice a chat task card makes).
// The visit drives the job and never the other way round: it is answered for in
// the diary, where the account is written and the client is asked.

export type VisitTaskState = "TODO" | "SUBMITTED" | "DONE";
export type VisitTaskPlan = { dayKey: string; state: VisitTaskState };

/**
 * The job a visit should have, or null when it should have none.
 *
 * No day, no job: there is nowhere on a week to put it. A visit that did not
 * happen or was called off has none either — it stopped being work to do, and
 * the diary keeps the record of it.
 */
export function visitTaskPlan(visit: VisitLike, timeZone: string): VisitTaskPlan | null {
  const when = at(visit.scheduledAt);
  if (when == null) return null;

  const state: VisitTaskState | null =
    visit.state === "PLANNED"
      ? "TODO"
      : visit.state === "REPORTED"
        ? "SUBMITTED"
        : visit.state === "VISITED"
          ? "DONE"
          : null;
  if (!state) return null;

  // The studio's calendar day, not the server's: a visit at half past midnight
  // in Amman is still yesterday evening in UTC.
  return { dayKey: dayKeyIn(timeZone, new Date(when)), state };
}

export function visitTaskTitle(title: string): string {
  return `Site visit: ${title}`.slice(0, 200);
}

/** What the job says under its title: when, where, who for, and what for. */
export function visitTaskNote(
  visit: { scheduledAt: Date | string | null; location: string | null; clientName: string | null; purpose: string | null },
  timeZone: string
): string | null {
  const when = at(visit.scheduledAt);
  const lines = [
    when != null ? `At ${formatTimeIn(timeZone, new Date(when))}` : null,
    visit.location?.trim() ? `Where: ${visit.location.trim()}` : null,
    visit.clientName?.trim() ? `Client: ${visit.clientName.trim()}` : null,
    visit.purpose?.trim() || null,
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : null;
}

/** Said on the job itself, because the job is not where a visit is finished. */
export const VISIT_TASK_DELIVERABLE = "Write the visit up under Site visits when you are back. That is what finishes it.";

// ---------------------------------------------------------------------------
// The reminder the day before

export const REMIND_BEFORE_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the reminder for this visit is owed now: planned, and inside the day
 * before it.
 *
 * Still ahead only — a reminder for something already under way is not one —
 * and a visit written down less than a day ahead is reminded on the next pass,
 * since "tomorrow at nine" said this evening is still worth hearing. Asking
 * once is the notification's own unique key (`visitReminderKey`), not a check
 * here, so a pass that runs twice or wakes late says it once.
 */
export function reminderDue(visit: VisitLike, now: number = Date.now()): boolean {
  const when = at(visit.scheduledAt);
  if (visit.state !== "PLANNED" || when == null) return false;
  return now >= when - REMIND_BEFORE_MS && now < when;
}

/** Carries the moment it is for, so a visit that moves earns a new reminder. */
export function visitReminderKey(visitId: string, scheduledAt: Date): string {
  return `SITE_VISIT_REMINDER:${visitId}:${scheduledAt.toISOString()}`;
}

export function visitReminderCopy(
  visit: { title: string; location: string | null; scheduledAt: Date },
  timeZone: string,
  now: Date = new Date()
): { title: string; message: string } {
  const today = dayKeyIn(timeZone, now);
  const day = dayKeyIn(timeZone, visit.scheduledAt);
  const title =
    day === today ? "Site visit today" : day === shiftDayKey(today, 1) ? "Site visit tomorrow" : "Site visit coming up";

  const place = visit.location?.trim() ? ` · ${visit.location.trim()}` : "";
  return {
    title,
    message: `${visit.title} — ${formatDayIn(timeZone, visit.scheduledAt)} · ${formatTimeIn(timeZone, visit.scheduledAt)}${place}`,
  };
}
