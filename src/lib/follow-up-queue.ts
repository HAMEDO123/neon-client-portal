import { prisma } from "@/lib/db";
import { firstAskableDay, followUpKey, followUpsFor, type FollowUpKind } from "@/lib/follow-ups";
import { dayKeyToDate, instantAt } from "@/lib/time";
import type { WorkHours } from "@/lib/work-hours";

// The questions the platform owes people, written down so they can be asked
// later. This is the half that touches the database; when each question is due
// is decided in lib/follow-ups.ts, where it is tested without one.
//
// Nothing here sends anything. A row is a question that is owed, and sending is
// a separate job that can run as often as it likes: the unique `dedupeKey`
// means publishing a plan twice, or a poller overlapping itself, still asks
// once.

export type PlanSlot = {
  from: string;
  to: string;
  keep: boolean;
  /** The board cell this block is about, where it has one. */
  entryId: string | null;
  /** Or the week-board job it became. */
  jobId: string | null;
};

/**
 * Writes the questions for one planned day.
 *
 * An existing question is left exactly as it is: it may already have been asked
 * and answered, and a second publish must not reopen it. A block that moved to
 * a new time is a new question with a new key, which is the behaviour we want —
 * the old one stays as the record of what was asked at the time.
 */
export async function scheduleFollowUps({
  employeeId,
  dayKey,
  hours,
  timezone,
  blocks,
}: {
  employeeId: string;
  dayKey: string;
  hours: WorkHours;
  timezone: string;
  blocks: PlanSlot[];
}): Promise<{ written: number }> {
  const wanted = followUpsFor({ dayKey, hours, blocks });
  const day = dayKeyToDate(dayKey);
  let written = 0;

  for (const followUp of wanted) {
    const dueAt = instantAt(dayKey, followUp.at, timezone);
    if (!dueAt) continue;

    const slot = followUp.block == null ? null : blocks[followUp.block];
    const dedupeKey = followUpKey(employeeId, dayKey, followUp.kind, followUp.block, followUp.at);

    await prisma.scheduledFollowUp.upsert({
      where: { dedupeKey },
      create: {
        employeeId,
        day,
        kind: followUp.kind,
        blockIndex: followUp.block,
        entryId: slot?.entryId ?? null,
        jobId: slot?.jobId ?? null,
        dueAt,
        dedupeKey,
      },
      update: {},
    });
    written += 1;
  }

  return { written };
}

export type DueFollowUp = {
  id: string;
  employeeId: string;
  kind: FollowUpKind;
  blockIndex: number | null;
  entryId: string | null;
  jobId: string | null;
  dueAt: Date;
  dedupeKey: string;
  day: Date;
};

/**
 * Questions about today that have come due and have not been asked.
 *
 * Only today's, in the company's timezone (`firstAskableDay`): a poller that
 * was down overnight must not wake up to a morning of "did you start it?" about
 * yesterday. Older questions are left unasked rather than stamped — an asked
 * question without an answer is what the day board counts as unanswered, and
 * nobody received these.
 *
 * Capped as well, so even a backlog from earlier today goes out a few dozen at a
 * time; the rest keep until the next run, which is minutes away.
 */
export async function dueFollowUps(
  now: Date = new Date(),
  { timeZone, limit = 40 }: { timeZone: string; limit?: number }
): Promise<DueFollowUp[]> {
  const rows = await prisma.scheduledFollowUp.findMany({
    where: {
      dueAt: { lte: now },
      askedAt: null,
      day: { gte: dayKeyToDate(firstAskableDay(timeZone, now)) },
    },
    orderBy: { dueAt: "asc" },
    take: limit,
    select: {
      id: true,
      employeeId: true,
      kind: true,
      blockIndex: true,
      entryId: true,
      jobId: true,
      dueAt: true,
      dedupeKey: true,
      day: true,
    },
  });

  return rows.map((row) => ({ ...row, kind: row.kind as FollowUpKind }));
}

/** Records that a question went out, so it is never asked twice. */
export async function markAsked(id: string): Promise<void> {
  await prisma.scheduledFollowUp.update({
    where: { id },
    data: { askedAt: new Date(), attempts: { increment: 1 } },
  });
}

/**
 * What the employee said. Kept even when it is "blocked" or "not started":
 * the answer is the record, and silence is not treated as one.
 */
export async function recordAnswer(id: string, answer: string, note?: string | null): Promise<void> {
  await prisma.scheduledFollowUp.update({
    where: { id },
    data: { answer, answerNote: note?.trim()?.slice(0, 2000) || null, answeredAt: new Date() },
  });
}

/**
 * The question this person still owes an answer to about one task.
 *
 * Only one that has actually been asked: a question whose time has not come is
 * not something to put in front of somebody. The most recent, because a block
 * that ran long may have collected both a middle and an end.
 */
export async function openFollowUpForTask(employeeId: string, entryId: string) {
  return prisma.scheduledFollowUp.findFirst({
    where: { employeeId, entryId, answeredAt: null, askedAt: { not: null } },
    orderBy: { dueAt: "desc" },
    select: { id: true, kind: true, dueAt: true },
  });
}

/** Everything owed about one person's day, for a screen that shows it. */
export async function followUpsForDay(employeeId: string, dayKey: string) {
  return prisma.scheduledFollowUp.findMany({
    where: { employeeId, day: dayKeyToDate(dayKey) },
    orderBy: { dueAt: "asc" },
  });
}
