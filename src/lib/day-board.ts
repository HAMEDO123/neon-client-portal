// The manager's view of a day, as judgements rather than as rows.
//
// Pure on purpose. "Needs confirming", "said they started but it is still
// pending", "more planned than the day holds" are the opinions the whole screen
// exists to express, and an opinion belongs somewhere it can be checked without
// a database.
//
// The rule underneath all of them: silence is not evidence. Somebody who has
// not answered is somebody to ask, never somebody who did nothing — the two
// look identical in the data and must never look identical on the screen.

export type AnswerNeedingManager = {
  /** "blocked", "need-info", "more-time". */
  answer: string;
  note: string | null;
  taskName: string | null;
};

export type Contradiction = {
  taskName: string;
  /** What they said, against a task that never moved. */
  said: string;
};

export type BlockedWork = {
  taskName: string;
  reason: string;
  /** Who can clear it, where anybody was named. */
  who: string | null;
};

export type PersonDay = {
  employeeId: string;
  name: string;
  /** Whether a plan was put on the board for this day at all. */
  planned: boolean;
  /** Minutes of work the plan fills. */
  plannedMinutes: number;
  /** What the day can hold, from the working-day settings. */
  capacityMinutes: number;
  /** Questions asked and still waiting on an answer. */
  unanswered: number;
  /** How many of the day's blocks have been started, by their own say-so. */
  started: number;
  blocks: number;
  needsManager: AnswerNeedingManager[];
  contradictions: Contradiction[];
  blocked: BlockedWork[];
};

/** More work on the day than the day holds. */
export function overloaded(day: PersonDay): boolean {
  return day.capacityMinutes > 0 && day.plannedMinutes > day.capacityMinutes;
}

/** Nothing was ever put on this person's day. */
export function unplanned(day: PersonDay): boolean {
  return !day.planned;
}

/**
 * How much this person's day wants looking at, for ordering the screen.
 *
 * Weighted by what a manager can actually do something about: work that is
 * stuck on somebody else first, then claims that do not match the board, then
 * a day nobody can finish, then silence. Silence counts, but least — it is a
 * question, not a failure.
 */
export function attentionScore(day: PersonDay): number {
  return (
    day.blocked.length * 8 +
    day.contradictions.length * 6 +
    day.needsManager.length * 5 +
    (overloaded(day) ? 4 : 0) +
    (unplanned(day) ? 3 : 0) +
    Math.min(day.unanswered, 5)
  );
}

/** The people whose day needs the manager, most pressing first. */
export function needingAttention(days: PersonDay[]): PersonDay[] {
  return days
    .filter((day) => attentionScore(day) > 0)
    .sort((a, b) => attentionScore(b) - attentionScore(a) || a.name.localeCompare(b.name));
}

export type DaySummary = {
  people: number;
  planned: number;
  unplanned: number;
  overloaded: number;
  blocked: number;
  /** Questions nobody has answered yet, across everybody. */
  unanswered: number;
  /** Claims that do not match what the board says. */
  contradictions: number;
};

export function summarise(days: PersonDay[]): DaySummary {
  return {
    people: days.length,
    planned: days.filter((day) => day.planned).length,
    unplanned: days.filter(unplanned).length,
    overloaded: days.filter(overloaded).length,
    blocked: days.reduce((total, day) => total + day.blocked.length, 0),
    unanswered: days.reduce((total, day) => total + day.unanswered, 0),
    contradictions: days.reduce((total, day) => total + day.contradictions.length, 0),
  };
}

/**
 * What to say about a day in one line.
 *
 * Deliberately never says anybody did nothing: an unanswered question is
 * reported as an unanswered question.
 */
export function describeDay(day: PersonDay): string {
  if (!day.planned) return "No plan on the day yet";
  if (day.blocked.length > 0) return `${day.blocked.length} blocked`;
  if (day.contradictions.length > 0) return "Said started, board still pending";
  if (day.needsManager.length > 0) return `${day.needsManager.length} waiting on you`;
  if (overloaded(day)) return "More planned than the day holds";
  if (day.unanswered > 0) return `${day.unanswered} unanswered`;
  if (day.blocks > 0 && day.started === day.blocks) return "All started";
  return "On the day";
}

/** Minutes over capacity, for showing how far past the line a day is. */
export function overBy(day: PersonDay): number {
  return Math.max(0, day.plannedMinutes - day.capacityMinutes);
}
