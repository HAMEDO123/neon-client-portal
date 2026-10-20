import { minutesOf } from "@/lib/work-hours";

// Stepping out in the middle of a day: a clock-out and a clock-in again.
//
// The studio asked for it on 2026-10-20 — "if someone got out and returned".
// The device cannot be trusted to say so on its own: a day's reads are one
// arrival, one departure and whatever else, and a double scan at the door
// looks exactly like a two-minute errand. So the manager records it, on the
// day's cell in the attendance month, as one or more "out at — back at".
//
// The time away is charged as lateness is: in whole hours, rounded up, over
// the day's total — twenty minutes out is an hour, ninety is two. The studio's
// rule for the start of the day, applied to the middle of it.
//
// Pure, and tested.

/** One time out: "HH:MM" left, "HH:MM" back. */
export type Break = { out: string; back: string };

/** Reads the boxes a form posted, in pairs. A row with both boxes empty is no row. */
export function readBreaks(outs: unknown[], backs: unknown[]): { ok: true; breaks: Break[] } | { ok: false; error: string } {
  const breaks: Break[] = [];
  const count = Math.max(outs.length, backs.length);

  for (let index = 0; index < count; index++) {
    const out = String(outs[index] ?? "").trim();
    const back = String(backs[index] ?? "").trim();
    if (!out && !back) continue;

    const from = minutesOf(out);
    const to = minutesOf(back);
    if (from == null || to == null) return { ok: false, error: "Give both times for each time out: when they left, and when they came back." };
    if (to <= from) return { ok: false, error: `${back} is not after ${out}: they came back after they left.` };
    breaks.push({ out, back });
  }

  breaks.sort((a, b) => (minutesOf(a.out) ?? 0) - (minutesOf(b.out) ?? 0));
  for (let index = 1; index < breaks.length; index++) {
    if ((minutesOf(breaks[index].out) ?? 0) < (minutesOf(breaks[index - 1].back) ?? 0)) {
      return { ok: false, error: "Two of those times out overlap." };
    }
  }
  return { ok: true, breaks };
}

/** Minutes away, all the times out of one day together. */
export function awayMinutesOf(breaks: Break[]): number {
  return breaks.reduce((total, item) => total + Math.max(0, (minutesOf(item.back) ?? 0) - (minutesOf(item.out) ?? 0)), 0);
}

/** What the time away costs: whole hours, rounded up, as lateness is. */
export function awayHoursOf(breaks: Break[]): number {
  const minutes = awayMinutesOf(breaks);
  return minutes > 0 ? Math.ceil(minutes / 60) : 0;
}

/** The times out as they were stored. Anything unreadable is no time out, never a guess. */
export function storedBreaks(value: unknown): Break[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { out, back } = item as Record<string, unknown>;
    if (typeof out !== "string" || typeof back !== "string") return [];
    const from = minutesOf(out);
    const to = minutesOf(back);
    return from != null && to != null && to > from ? [{ out, back }] : [];
  });
}
