import type { TaskState } from "@/generated/prisma/enums";

// How long each stage gets, and what that means for the one after it.
//
// The delivery process is a chain: the 2D plan, then the SketchUp model, then
// the site visit. Giving each step a length in days turns that chain into
// dates — stage two starts when stage one is finished and is due its own
// length later — so "from the plan to the site visit is five days" is a sum of
// the steps rather than a date somebody has to remember to type.
//
// Two rules keep it honest:
//
//   * a deadline the manager typed on a cell always wins over a computed one;
//   * a stage that has actually started or finished uses that real date, not
//     the predicted one, so one slow step moves everything after it rather
//     than quietly going overdue on paper.
//
// Pure on purpose: no database, no clock of its own. Both the employee's
// countdown and the job that chases late work read the same function.

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(from: Date, days: number) {
  return new Date(from.getTime() + days * DAY_MS);
}

export type StageInput = {
  entryId: string;
  /** Position in the process, low to high. */
  order: number;
  /** How many days this stage is allowed to take. Null means untimed. */
  durationDays: number | null;
  state: TaskState;
  startedAt: Date | null;
  completedAt: Date | null;
  scheduledFor: Date | null;
  /** A deadline typed by hand, which overrides anything computed. */
  dueAt: Date | null;
};

export type StagePlan = {
  entryId: string;
  startsAt: Date;
  dueBy: Date | null;
  /** Where the deadline came from, so the UI can say "set by you" honestly. */
  source: "explicit" | "derived" | "none";
};

/**
 * Walks one project's stages in order and gives each a start and a deadline.
 * `anchor` is when the project's work begins — the first scheduled day, or the
 * day the project was created.
 */
export function planStages(stages: StageInput[], anchor: Date): StagePlan[] {
  const ordered = [...stages].sort((a, b) => a.order - b.order);

  let cursor = anchor;
  const plans: StagePlan[] = [];

  for (const stage of ordered) {
    // What actually happened beats what was predicted, in that order.
    const startsAt = stage.startedAt ?? stage.scheduledFor ?? cursor;

    const derived = stage.durationDays != null ? addDays(startsAt, stage.durationDays) : null;
    const dueBy = stage.dueAt ?? derived;

    plans.push({
      entryId: stage.entryId,
      startsAt,
      dueBy,
      source: stage.dueAt ? "explicit" : derived ? "derived" : "none",
    });

    // The next stage cannot begin before this one ends. A finished stage hands
    // over its real completion date; an unfinished one hands over its deadline,
    // which is the earliest the next step could honestly start.
    cursor = stage.completedAt ?? dueBy ?? cursor;
  }

  return plans;
}

// --- What the employee is shown --------------------------------------------

export type Countdown = {
  /** Whole days remaining. Negative once the deadline has passed. */
  days: number;
  overdue: boolean;
  label: string;
  tone: "calm" | "soon" | "late";
};

/**
 * Days between now and a deadline, counted the way a person counts them: a
 * deadline later today is "today", and any part of tomorrow is "1 day".
 */
export function daysUntil(dueBy: Date, now: Date) {
  return Math.ceil((dueBy.getTime() - now.getTime()) / DAY_MS);
}

export function countdownOf(dueBy: Date, now = new Date()): Countdown {
  const days = daysUntil(dueBy, now);

  if (days < 0) {
    const late = Math.abs(days);
    return {
      days,
      overdue: true,
      label: late === 1 ? "1 day late" : `${late} days late`,
      tone: "late",
    };
  }

  if (days === 0) return { days, overdue: false, label: "Due today", tone: "soon" };
  if (days === 1) return { days, overdue: false, label: "1 day left", tone: "soon" };

  return { days, overdue: false, label: `${days} days left`, tone: days <= 3 ? "soon" : "calm" };
}

/**
 * The running total along the process: how many days in a stage begins and
 * ends, so the settings screen can say "the plan through the site visit is
 * five days" without anyone adding it up.
 */
export function cumulativeDays(durations: (number | null)[]) {
  let day = 1;
  return durations.map((duration) => {
    if (duration == null || duration <= 0) return { startDay: day, endDay: null as number | null };
    const span = { startDay: day, endDay: day + duration - 1 };
    day += duration;
    return span;
  });
}

/** Total length of a run of stages, ignoring the untimed ones. */
export function totalDays(durations: (number | null)[]) {
  return durations.reduce<number>((sum, duration) => sum + (duration && duration > 0 ? duration : 0), 0);
}
