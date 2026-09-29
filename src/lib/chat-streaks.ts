import { dayKeyIn, shiftDayKey } from "@/lib/time";

// A private chat's streak, Snapchat's rule: how many calendar days in a row
// BOTH people have written at least one message. Days are the studio's, not
// the server's — a message at 00:30 in Amman belongs to that Amman day, even
// though it is still yesterday in UTC.
//
// Pure: the database side (chat-extras.ts) hands over the days each person
// wrote on, already bucketed into the studio's calendar; everything that
// decides the number is here, pinned by tests/chat-streaks.test.ts.
//
// - Today counts once both have written today.
// - Until then, a streak that ran through yesterday is still alive — counted
//   through yesterday — and `atRisk`, because it ends at midnight unless both
//   write today.
// - A day either of them missed ends it. No streak is null, never { count: 0 }.

export type ChatStreak = { count: number; atRisk: boolean };

/** How far back a streak is looked for. Longer runs than this read as this long. */
export const STREAK_LOOKBACK_DAYS = 1000;

/** The studio-calendar day a message belongs to, as YYYY-MM-DD. */
export function streakDay(instant: Date, timeZone: string) {
  return dayKeyIn(timeZone, instant);
}

/** The days both people wrote on: the days in both lists. */
export function sharedDays(first: Iterable<string>, second: Iterable<string>) {
  const theirs = new Set(second);
  const both = new Set<string>();
  for (const day of first) if (theirs.has(day)) both.add(day);
  return both;
}

/**
 * The streak, from the days on which both people wrote and today's key in the
 * studio's timezone. Days after today (a clock that disagrees) are ignored.
 */
export function chatStreak(bothDays: Iterable<string>, today: string): ChatStreak | null {
  const days = bothDays instanceof Set ? (bothDays as Set<string>) : new Set(bothDays);

  const yesterday = shiftDayKey(today, -1);
  let start: string;
  let atRisk: boolean;
  if (days.has(today)) {
    start = today;
    atRisk = false;
  } else if (days.has(yesterday)) {
    start = yesterday;
    atRisk = true;
  } else {
    return null;
  }

  let count = 0;
  let day = start;
  while (days.has(day) && count < STREAK_LOOKBACK_DAYS) {
    count += 1;
    day = shiftDayKey(day, -1);
  }
  return count > 0 ? { count, atRisk } : null;
}

/**
 * The same from raw messages: who wrote (a side key — "admin" or an employee
 * id) and when. Only the two named sides count; anybody else is ignored.
 */
export function streakFromMessages(
  messages: { side: string; at: Date }[],
  sides: [string, string],
  now: Date,
  timeZone: string
): ChatStreak | null {
  const [first, second] = sides;
  const firstDays = new Set<string>();
  const secondDays = new Set<string>();
  for (const message of messages) {
    if (message.side === first) firstDays.add(streakDay(message.at, timeZone));
    else if (message.side === second) secondDays.add(streakDay(message.at, timeZone));
  }
  return chatStreak(sharedDays(firstDays, secondDays), streakDay(now, timeZone));
}
