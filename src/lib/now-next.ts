import { lunchWindow, minutesOf, remainingMinutes, timeOf, type WorkHours } from "@/lib/work-hours";

// What somebody should be doing now, and what comes after it.
//
// Pure on purpose: "now" is arithmetic over the plan and the clock, and the
// employee's screen should not be the place that works it out. Everything here
// is wall-clock in the company timezone, as "HH:MM".
//
// One decision worth stating: being on a break and having a block running are
// separate facts, not alternatives. A block that runs through lunch is still
// the block somebody is on; the break is something the screen says as well,
// not instead.

export type PlanSlot = {
  from: string;
  to: string;
  what: string;
  /** Blocks that were never put on the day are not part of it. */
  keep: boolean;
  /** What it points at, where it points at anything. */
  entryId: string | null;
  jobId: string | null;
};

export type NowNext = {
  /** The block the clock is inside, if any. */
  now: PlanSlot | null;
  /** The next block due to start. */
  next: PlanSlot | null;
  /** Minutes left of the current block. */
  leftOfBlock: number | null;
  /** Minutes until the next block starts. */
  untilNext: number | null;
  /** Minutes of working time left in the day. */
  leftOfDay: number;
  onBreak: boolean;
  beforeWork: boolean;
  afterWork: boolean;
};

function usable(blocks: PlanSlot[]): { slot: PlanSlot; from: number; to: number }[] {
  return blocks
    .filter((slot) => slot.keep)
    .map((slot) => ({ slot, from: minutesOf(slot.from), to: minutesOf(slot.to) }))
    .filter((row): row is { slot: PlanSlot; from: number; to: number } => {
      return row.from != null && row.to != null && row.to > row.from;
    })
    .sort((a, b) => a.from - b.from);
}

/**
 * Where somebody is in their day.
 *
 * A plan with nothing on it still answers the question: how much of the day is
 * left, and whether it has started at all. Saying "nothing" is an answer; a
 * blank screen is not.
 */
export function nowAndNext(blocks: PlanSlot[], hours: WorkHours, time: string): NowNext {
  const at = minutesOf(time);
  const start = minutesOf(hours.start) ?? 0;
  const end = minutesOf(hours.end) ?? 0;
  const lunch = lunchWindow(hours);
  const rows = usable(blocks);

  if (at == null) {
    return {
      now: null,
      next: rows[0]?.slot ?? null,
      leftOfBlock: null,
      untilNext: null,
      leftOfDay: remainingMinutes(hours, hours.start),
      onBreak: false,
      beforeWork: true,
      afterWork: false,
    };
  }

  const current = rows.find((row) => at >= row.from && at < row.to) ?? null;
  const upcoming = rows.find((row) => row.from > at && row !== current) ?? null;

  return {
    now: current?.slot ?? null,
    next: upcoming?.slot ?? null,
    leftOfBlock: current ? current.to - at : null,
    untilNext: upcoming ? upcoming.from - at : null,
    leftOfDay: remainingMinutes(hours, time),
    // Said alongside whatever is running, never instead of it.
    onBreak: at >= lunch.from && at < lunch.to,
    beforeWork: at < start,
    afterWork: at >= end,
  };
}

/** "1h 20m left", or "20m left" — what a person would say about a stretch. */
export function describeMinutes(minutes: number): string {
  if (minutes <= 0) return "no time left";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * The one line the employee's screen leads with.
 *
 * Never scolds and never guesses: outside working hours it says so, and a day
 * with nothing on it says that rather than implying somebody is idle.
 */
export function headline(state: NowNext, hours: WorkHours): string {
  if (state.beforeWork) return `The day starts at ${hours.start}`;
  if (state.afterWork) return "That is the day";
  if (state.now) return state.now.what;
  if (state.onBreak) return `Break until ${timeOf(lunchWindow(hours).to)}`;
  if (state.next) return `Next at ${state.next.from}`;
  return "Nothing planned for today";
}
