// Somebody's day as it actually went, in time order — the timeline at the top
// of the team's home screen (the new UI, "my day as a timeline", 2026-11-18).
//
// Built from things that happened, never from a plan: when the device or the
// app saw them arrive, each line of their report (each is stamped with the
// time it was written), and every move their work made today — started, sent
// for review, approved, sent back. Then "now", and the hour their day is owed
// until. Day plans are not used here because they have not been published
// since September; a timeline drawn from plans would be empty every day.
//
// Pure, so the ordering and the reading of a report line are tested.

export type TimelineKind = "clock-in" | "report" | "started" | "sent" | "approved" | "sent-back" | "now" | "ends";

export type TimelineItem = {
  minutes: number;
  kind: TimelineKind;
  title: string;
  /** Where tapping it goes, when there is somewhere. */
  href?: string;
  /** After "now": what is still to come, drawn quieter. */
  future: boolean;
};

export type TimelineChange = { minutes: number; toState: string; fromState: string; title: string; href?: string };

/** "HH:MM" → minutes past midnight, or null. */
export function minutesOfClock(value: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * One line of the day's report, read back into a time and words.
 *
 * Lines are written "HH:MM — what" (`appendLine`); a line typed without a time
 * — pasted in, or written before lines were stamped — has no place on a
 * timeline and is left out rather than placed somewhere it was not.
 */
export function readReportLine(line: string): { minutes: number; text: string } | null {
  const match = /^(\d{1,2}:\d{2})\s*[—–-]\s*(.+)$/.exec(line.trim());
  if (!match) return null;
  const minutes = minutesOfClock(match[1]);
  const text = match[2].trim();
  return minutes == null || !text ? null : { minutes, text };
}

/** What a move of a piece of work says on the timeline, or nothing. */
export function kindOfChange(fromState: string, toState: string): TimelineKind | null {
  if (toState === "IN_PROGRESS") return fromState === "SUBMITTED" ? "sent-back" : "started";
  if (toState === "SUBMITTED") return "sent";
  if (toState === "DONE") return "approved";
  return null;
}

/** A report line is the whole report, sometimes; on a timeline one line is enough of it. */
function shorten(text: string, length = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

/** Started and sent within this many minutes is one thing that happened: it was done. */
export const QUICK_SEND_MINUTES = 30;

/**
 * A start followed soon after by the same task being sent is one line, not
 * two: the team often taps Start and sends the proof a minute later, and a
 * timeline that says each of them twice is twice as long and no clearer.
 */
export function collapseQuickStarts(changes: TimelineChange[]): TimelineChange[] {
  const keyOf = (change: TimelineChange) => change.href ?? change.title;
  return changes.filter((change) => {
    if (kindOfChange(change.fromState, change.toState) !== "started") return true;
    return !changes.some(
      (later) =>
        keyOf(later) === keyOf(change) &&
        later.minutes >= change.minutes &&
        later.minutes - change.minutes <= QUICK_SEND_MINUTES &&
        (later.toState === "SUBMITTED" || later.toState === "DONE")
    );
  });
}

export function buildTimeline(input: {
  arrivedMinutes: number | null;
  endsAtMinutes: number | null;
  nowMinutes: number;
  reportLines: string[];
  changes: TimelineChange[];
}): TimelineItem[] {
  const items: Omit<TimelineItem, "future">[] = [];

  if (input.arrivedMinutes != null) {
    items.push({ minutes: input.arrivedMinutes, kind: "clock-in", title: "Clocked in" });
  }
  for (const line of input.reportLines) {
    const read = readReportLine(line);
    if (read) items.push({ minutes: read.minutes, kind: "report", title: shorten(read.text) });
  }
  for (const change of collapseQuickStarts(input.changes)) {
    const kind = kindOfChange(change.fromState, change.toState);
    if (kind) items.push({ minutes: change.minutes, kind, title: change.title, href: change.href });
  }
  // Only a day somebody is in has a "now" and an end owed.
  if (input.arrivedMinutes != null) {
    items.push({ minutes: input.nowMinutes, kind: "now", title: "Now" });
    if (input.endsAtMinutes != null && input.endsAtMinutes > input.nowMinutes) {
      items.push({ minutes: input.endsAtMinutes, kind: "ends", title: "Clock out by" });
    }
  }

  // Time order; at the same minute, what happened before "now" and the end last.
  const rank = (kind: TimelineKind) => (kind === "now" ? 1 : kind === "ends" ? 2 : 0);
  return items
    .sort((a, b) => a.minutes - b.minutes || rank(a.kind) - rank(b.kind))
    .map((item) => ({ ...item, future: item.kind === "ends" || item.minutes > input.nowMinutes }));
}
