import type { TaskState } from "@/generated/prisma/enums";

// How long a run of steps gets, and what that means for the run after it.
//
// Nobody times a delivery process one box at a time. "Site visit through BOQ is
// four days" is one decision covering four steps, so a period is a *range* —
// a first step, a last step and a number of days — and every step inside it
// shares the deadline the range produces.
//
// Ranges chain: the next one starts when this one is finished, so the whole
// process carries dates without anyone typing a date on a project.
//
// Two rules keep those dates honest:
//
//   * a deadline the manager typed on a cell always wins over a computed one;
//   * a range whose work has actually finished hands the real completion date
//     to the next range, so one slow stretch moves everything after it rather
//     than quietly going overdue on paper.
//
// Pure on purpose: no database, no clock of its own. The employee's countdown
// and the job that chases late work read the same function.

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(from: Date, days: number) {
  return new Date(from.getTime() + days * DAY_MS);
}

export type StageInput = {
  entryId: string;
  taskId: string;
  /** Position in the process, low to high. */
  order: number;
  state: TaskState;
  startedAt: Date | null;
  completedAt: Date | null;
  scheduledFor: Date | null;
  /** A deadline typed by hand, which overrides anything computed. */
  dueAt: Date | null;
};

/** A run of steps and the days it is allowed to take. */
export type PeriodInput = {
  fromTaskId: string;
  toTaskId: string;
  days: number;
};

export type StagePlan = {
  entryId: string;
  startsAt: Date;
  dueBy: Date | null;
  /** Where the deadline came from, so the UI can say "set by you" honestly. */
  source: "explicit" | "derived" | "none";
};

/** The stages a period covers, in process order. Empty if it names nothing real. */
function spanOf(stages: StageInput[], period: PeriodInput) {
  const from = stages.findIndex((stage) => stage.taskId === period.fromTaskId);
  const to = stages.findIndex((stage) => stage.taskId === period.toTaskId);
  if (from === -1 || to === -1) return null;
  // Naming the range backwards is the same range; nobody means an empty one.
  return from <= to ? { start: from, end: to } : { start: to, end: from };
}

/**
 * Walks one project's stages in order and gives each a start and a deadline.
 * `anchor` is when the project's work begins — the first scheduled day, or the
 * day the project was created.
 */
export function planStages(stages: StageInput[], periods: PeriodInput[], anchor: Date): StagePlan[] {
  const ordered = [...stages].sort((a, b) => a.order - b.order);

  // Each step learns which range it belongs to. A step in no range is untimed
  // and nobody is chased about it. Where ranges overlap, the earlier-defined
  // one wins, which is the one the manager can see first in the list.
  const spans = periods
    .map((period) => ({ period, span: spanOf(ordered, period) }))
    .filter((entry): entry is { period: PeriodInput; span: { start: number; end: number } } => entry.span !== null);

  const spanOfIndex = new Map<number, { period: PeriodInput; span: { start: number; end: number } }>();
  for (const entry of spans) {
    for (let i = entry.span.start; i <= entry.span.end; i++) {
      if (!spanOfIndex.has(i)) spanOfIndex.set(i, entry);
    }
  }

  const plans: StagePlan[] = new Array(ordered.length);
  let cursor = anchor;
  let index = 0;

  while (index < ordered.length) {
    const covering = spanOfIndex.get(index);

    if (!covering) {
      const stage = ordered[index];
      const startsAt = stage.startedAt ?? stage.scheduledFor ?? cursor;
      plans[index] = {
        entryId: stage.entryId,
        startsAt,
        dueBy: stage.dueAt,
        source: stage.dueAt ? "explicit" : "none",
      };
      // An untimed step consumes no days, but a hand-typed deadline on it is
      // still a fact the steps behind it have to wait for.
      cursor = stage.completedAt ?? stage.dueAt ?? cursor;
      index += 1;
      continue;
    }

    // The whole run is planned at once.
    const { span, period } = covering;
    const members = ordered.slice(span.start, span.end + 1);

    // What actually happened beats what was predicted, in that order.
    const started = members.map((stage) => stage.startedAt ?? stage.scheduledFor).filter(Boolean) as Date[];
    const startsAt = started.length ? new Date(Math.min(...started.map((date) => date.getTime()))) : cursor;
    const derived = addDays(startsAt, period.days);

    for (const [offset, stage] of members.entries()) {
      plans[span.start + offset] = {
        entryId: stage.entryId,
        startsAt,
        dueBy: stage.dueAt ?? derived,
        source: stage.dueAt ? "explicit" : "derived",
      };
    }

    // The next run cannot begin before this one ends. A finished run hands over
    // when its last step actually completed; an unfinished one hands over its
    // deadline, the earliest the next could honestly start.
    const allDone = members.every((stage) => stage.completedAt);
    const finishedAt = allDone
      ? new Date(Math.max(...members.map((stage) => stage.completedAt!.getTime())))
      : null;
    cursor = finishedAt ?? derived;

    index = span.end + 1;
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
 * Where each range sits along the process, so the settings screen can say
 * "site visit through BOQ is days 1–4" without anyone adding it up.
 */
export function periodTimeline(
  orderedTaskIds: string[],
  periods: PeriodInput[]
): { period: PeriodInput; startDay: number; endDay: number; steps: number }[] {
  const indexOf = new Map(orderedTaskIds.map((id, index) => [id, index]));

  const placed = periods
    .map((period) => {
      const from = indexOf.get(period.fromTaskId);
      const to = indexOf.get(period.toTaskId);
      if (from === undefined || to === undefined) return null;
      return { period, start: Math.min(from, to), end: Math.max(from, to) };
    })
    .filter((entry): entry is { period: PeriodInput; start: number; end: number } => entry !== null)
    .sort((a, b) => a.start - b.start);

  let day = 1;
  return placed.map((entry) => {
    const startDay = day;
    const endDay = day + Math.max(1, entry.period.days) - 1;
    day = endDay + 1;
    return { period: entry.period, startDay, endDay, steps: entry.end - entry.start + 1 };
  });
}

/** Total length of the timed part of the process. */
export function totalDays(periods: PeriodInput[]) {
  return periods.reduce((sum, period) => sum + Math.max(0, period.days), 0);
}
