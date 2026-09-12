import {
  isWorkingTime,
  lunchWindow,
  minutesOf,
  nextWorkingMoment,
  timeOf,
  type WorkHours,
} from "@/lib/work-hours";

// When somebody should be asked about their day, and what they are being asked.
//
// Pure on purpose, and deliberately separate from anything that sends: what
// time a question is due is a fact about the working day and the plan, decided
// here where it can be checked, while sending is a side effect decided
// elsewhere. Nothing in this file writes, queues or notifies.
//
// The rule that matters most is the one that is easy to get wrong: nobody is
// chased during lunch or after they have gone home. Every time produced here
// has been through the working day first.

export type FollowUpKind =
  /** The day's plan, and a question: have you seen it, and can you start? */
  | "day-start"
  /** A block's time has come: did you start it? */
  | "block-start"
  /** A long block, halfway through: how is it going? */
  | "block-middle"
  /** A block's time is up: what happened? */
  | "block-end"
  /** The day is over: what was done, and what was not. */
  | "day-end";

export type PlannedSlot = {
  /** Wall-clock, "HH:MM". */
  from: string;
  to: string;
  /** Whether this block is on the day at all. */
  keep: boolean;
};

export type FollowUp = {
  kind: FollowUpKind;
  /** Which block it is about, by position in the plan. Null for the day itself. */
  block: number | null;
  /** The calendar day it belongs to. */
  dayKey: string;
  /** Wall-clock time in the company timezone, after the working day is applied. */
  at: string;
};

/** A block at least this long is worth one check part-way through. */
export const MID_CHECK_AFTER_MINUTES = 90;

/**
 * The key a follow-up is sent under.
 *
 * Derived from the event and never from the clock, like every other dedupe key
 * here, so a poller that runs twice — or a retried request — asks once. A block
 * that moves earns a new key, because it is a new question about a new time.
 */
export function followUpKey(
  employeeId: string,
  dayKey: string,
  kind: FollowUpKind,
  block: number | null,
  at: string
): string {
  return `FOLLOW_UP:${kind}:${employeeId}:${dayKey}:${block ?? "day"}:${at}`;
}

/**
 * A time moved to when it can actually be asked.
 *
 * Questions about something that is finishing are clamped to the end of the day
 * rather than pushed into tomorrow: "what happened with the last block" is a
 * question about today, and asking it tomorrow morning is asking too late.
 */
function askableAt(hours: WorkHours, dayKey: string, time: string, kind: FollowUpKind): FollowUp["at"] | null {
  const at = minutesOf(time);
  const start = minutesOf(hours.start) ?? 0;
  const end = minutesOf(hours.end) ?? 0;
  if (at == null) return null;

  const closing = kind === "block-end" || kind === "day-end";
  if (at >= end) return closing ? timeOf(end) : null;
  if (at < start) return timeOf(start);

  const lunch = lunchWindow(hours);
  if (at >= lunch.from && at < lunch.to) return timeOf(lunch.to);

  return timeOf(at);
}

/**
 * Every question worth asking about one planned day, in the order they are due.
 *
 * Blocks that were not ticked onto the day produce nothing: they were not
 * given to anybody, so there is nothing to ask about.
 */
export function followUpsFor({
  dayKey,
  hours,
  blocks,
  midCheckAfterMinutes = MID_CHECK_AFTER_MINUTES,
}: {
  dayKey: string;
  hours: WorkHours;
  blocks: PlannedSlot[];
  midCheckAfterMinutes?: number;
}): FollowUp[] {
  const found: FollowUp[] = [];

  const push = (kind: FollowUpKind, block: number | null, time: string) => {
    const at = askableAt(hours, dayKey, time, kind);
    if (at) found.push({ kind, block, dayKey, at });
  };

  push("day-start", null, hours.start);

  blocks.forEach((slot, index) => {
    if (!slot.keep) return;

    const from = minutesOf(slot.from);
    const to = minutesOf(slot.to);
    if (from == null || to == null || to <= from) return;

    push("block-start", index, slot.from);

    if (to - from >= midCheckAfterMinutes) {
      push("block-middle", index, timeOf(from + Math.round((to - from) / 2)));
    }

    push("block-end", index, slot.to);
  });

  push("day-end", null, hours.end);

  // Due order, and a stable one where two land on the same minute.
  return found
    .map((followUp, order) => ({ followUp, order }))
    .sort((a, b) => {
      const byTime = (minutesOf(a.followUp.at) ?? 0) - (minutesOf(b.followUp.at) ?? 0);
      return byTime !== 0 ? byTime : a.order - b.order;
    })
    .map((row) => row.followUp);
}

/** Whether a moment is one where somebody may be messaged at all. */
export function mayAskNow(hours: WorkHours, dayKey: string, time: string): boolean {
  return isWorkingTime(hours, time) && nextWorkingMoment(hours, dayKey, time).dayKey === dayKey;
}
