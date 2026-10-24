import { prisma } from "@/lib/db";
import { dayKeyToDate } from "@/lib/time";

// The day in the employee's own words, written a line at a time.
//
// It is one blob of text per person per day — the same row the long box on the
// requests page writes — because a report is something a manager reads as a
// paragraph, not a table of rows. Adding a line from the home screen appends
// to it rather than keeping a second list somewhere, so there is one account of
// the day and no question of which is the real one.

/** The longest a day's report may get, matching the box on the requests page. */
export const REPORT_LIMIT = 4000;

/**
 * One more thing done, added to what is already written.
 *
 * The time goes in front because this is written through the day rather than
 * remembered at the end of it: "took the measurements" is worth more to the
 * person reading it with the hour attached, and the employee is the only one
 * who can supply it at the moment it is true.
 *
 * Pure, so the joining is pinned by tests rather than by hope.
 */
export function appendLine(existing: string, line: string, at: string): string {
  const said = line.trim();
  if (!said) return existing;

  const entry = `${at} — ${said}`;
  const now = existing.trim() ? `${existing.trimEnd()}\n${entry}` : entry;

  // Trimmed from the front: the newest line is the one somebody just wrote and
  // the one they are looking for, so a day long enough to overflow loses its
  // oldest words rather than refusing the newest.
  return now.length <= REPORT_LIMIT ? now : now.slice(now.length - REPORT_LIMIT);
}

/** What has been written so far today, for the card on the home screen. */
export async function reportForDay(employeeId: string, dayKey: string) {
  const row = await prisma.dailyReport.findUnique({
    where: { employeeId_day: { employeeId, day: dayKeyToDate(dayKey) } },
    select: { text: true, updatedAt: true },
  });
  return { text: row?.text ?? "", updatedAt: row?.updatedAt ?? null };
}

/** The lines of it, for showing back what has been added. */
export function linesOf(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
