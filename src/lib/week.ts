import { dayKeyToDate, shiftDayKey } from "@/lib/time";

// The week the assignment board is laid out on.
//
// Weeks start on Sunday, which is the working week in Amman — Sunday through
// Thursday with Friday and Saturday at the end, so a normal week reads left to
// right without the weekend splitting it in half.
//
// Everything here works in day keys ("2026-09-10") rather than instants: which
// day a job falls on is a calendar question in the company's timezone, and a
// timestamp would make it a question about the server's.

export const WEEK_START_DAY = 0; // Sunday
export const DAYS_IN_WEEK = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The Sunday on or before the given day. */
export function weekStartKey(dayKey: string) {
  const date = dayKeyToDate(dayKey);
  const offset = (date.getUTCDay() - WEEK_START_DAY + DAYS_IN_WEEK) % DAYS_IN_WEEK;
  return shiftDayKey(dayKey, -offset);
}

/** The seven day keys of the week containing this day. */
export function weekDayKeys(dayKey: string) {
  const start = weekStartKey(dayKey);
  return Array.from({ length: DAYS_IN_WEEK }, (_, index) => shiftDayKey(start, index));
}

export function shiftWeek(dayKey: string, weeks: number) {
  return weekStartKey(shiftDayKey(weekStartKey(dayKey), weeks * DAYS_IN_WEEK));
}

/** Whole days between two day keys — 0 when they are the same day. */
export function daysBetween(fromKey: string, toKey: string) {
  return Math.round((dayKeyToDate(toKey).getTime() - dayKeyToDate(fromKey).getTime()) / DAY_MS);
}

export type DaySpan = { startKey: string; endKey: string };

/**
 * Where a job sits on one week's row: which column it starts in and how many
 * it covers, clipped to the week. Null when the job misses the week entirely.
 *
 * Clipping rather than dropping is the point — a job running Thursday to
 * Tuesday is real work in both weeks, and each week shows its own part of it.
 */
export function placeInWeek(span: DaySpan, weekKeys: string[]) {
  const first = weekKeys[0];
  const last = weekKeys[weekKeys.length - 1];

  if (daysBetween(span.endKey, first) > 0) return null; // ended before the week
  if (daysBetween(last, span.startKey) > 0) return null; // starts after it

  const startColumn = Math.max(0, daysBetween(first, span.startKey));
  const endColumn = Math.min(weekKeys.length - 1, daysBetween(first, span.endKey));

  return {
    startColumn,
    span: endColumn - startColumn + 1,
    // Whether the real job runs past the edge of this week, so the bar can say so.
    continuesBefore: daysBetween(first, span.startKey) < 0,
    continuesAfter: daysBetween(first, span.endKey) > weekKeys.length - 1,
  };
}

/**
 * Where a job lands when it is dropped on a day.
 *
 * The span moves whole — a two-day job dropped on Wednesday runs Wednesday and
 * Thursday — because picking a job up says when it happens, not how long it
 * takes. The day it was dropped on becomes its first day, whichever part of the
 * bar the pointer was over.
 */
export function moveSpanTo(span: DaySpan, dropKey: string) {
  const days = daysBetween(span.startKey, dropKey);
  return {
    days,
    startKey: dropKey,
    endKey: shiftDayKey(span.endKey, days),
  };
}

/** Lays out overlapping jobs so none of them sit on top of another. */
export function stackRows<T extends DaySpan>(spans: T[]): { item: T; row: number }[] {
  const ordered = [...spans].sort(
    (a, b) => daysBetween(b.startKey, a.startKey) || daysBetween(a.endKey, b.endKey)
  );

  // Each row remembers the last day it is occupied to; a job takes the first
  // row that is free by the time it starts.
  const rowEnds: string[] = [];
  const placed: { item: T; row: number }[] = [];

  for (const item of ordered) {
    let row = rowEnds.findIndex((end) => daysBetween(end, item.startKey) > 0);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(item.endKey);
    } else {
      rowEnds[row] = item.endKey;
    }
    placed.push({ item, row });
  }

  return placed;
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const DAY_NUMBER = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

export function dayLabel(dayKey: string) {
  const date = dayKeyToDate(dayKey);
  return { weekday: WEEKDAY.format(date), day: DAY_NUMBER.format(date), month: MONTH.format(date) };
}

/** "7 – 13 Sep" — the heading for a week. */
export function weekLabel(weekKeys: string[]) {
  const first = dayKeyToDate(weekKeys[0]);
  const last = dayKeyToDate(weekKeys[weekKeys.length - 1]);
  const sameMonth = first.getUTCMonth() === last.getUTCMonth();

  return sameMonth
    ? `${DAY_NUMBER.format(first)} – ${DAY_NUMBER.format(last)} ${MONTH.format(last)}`
    : `${DAY_NUMBER.format(first)} ${MONTH.format(first)} – ${DAY_NUMBER.format(last)} ${MONTH.format(last)}`;
}
