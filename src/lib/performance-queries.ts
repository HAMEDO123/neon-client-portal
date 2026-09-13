import { prisma } from "@/lib/db";
import { ownedBy } from "@/lib/employee-tasks";
import {
  deliveryAdherence,
  estimateAccuracy,
  firstReviewAcceptance,
  reworkRate,
  waitingOnBlockers,
  type BlockedFact,
  type DeliveryFact,
  type EstimateFact,
  type Indicator,
  type ReviewFact,
} from "@/lib/performance";
import { getTimezone } from "@/lib/settings";
import { dateToDayKey, dayKeyIn } from "@/lib/time";

// Turning what actually happened into the five indicators.
//
// Every fact here is a recorded event, never an inference: work reached DONE at
// a particular moment because TaskStateChange says so, and a submission was
// accepted first time because its own row says so. Nothing is guessed from
// absence, and nothing is counted that is not the work.
//
// Whose work it is comes from `ownedBy`, the same rule the board and the
// employee's own list use — a person named on the cell, then whoever holds that
// section of the project, then the step's standing owner. Writing that rule out
// again here is how somebody else's task ends up in your numbers: each branch
// of it requires the cell to have no assignee, so a cell handed to somebody else
// stops counting for the step's owner the moment it is handed over.
//
// Reads run one after another, the convention everywhere here.

/** How far back the numbers look, unless a caller says otherwise. */
export const WINDOW_DAYS = 30;

export type Performance = {
  onTime: Indicator;
  acceptedFirstTime: Indicator;
  rework: Indicator;
  blockedWaiting: Indicator;
  estimates: Indicator;
};

/** The instant `days` ago, for the window these numbers cover. */
export function sinceDays(days: number = WINDOW_DAYS, now: Date = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** One piece of finished work, however it was handed out. */
type Finished = {
  /** The cell or job it was, so the same work is only counted once. */
  key: string;
  entryId: string | null;
  jobId: string | null;
  doneAt: Date;
  /** Whether it met its deadline, or null where it never had one. */
  onTime: boolean | null;
  estimateHours: number | null;
};

export async function performanceFor(employeeId: string, since: Date = sinceDays()): Promise<Performance> {
  const timezone = await getTimezone();
  const mine = await ownedBy(employeeId);

  // Board cells this person owns that reached DONE inside the window.
  const entryDone = await prisma.taskStateChange.findMany({
    where: { toState: "DONE", createdAt: { gte: since }, entry: { is: mine } },
    orderBy: { createdAt: "asc" },
    select: {
      createdAt: true,
      entryId: true,
      entry: { select: { dueAt: true, estimateHours: true } },
    },
  });

  // And the week-board jobs handed to them by hand, which is where a planned
  // day's blocks land when they are not a cell of the board. Leaving these out
  // would quietly measure half of somebody's week.
  const jobDone = await prisma.taskStateChange.findMany({
    where: { toState: "DONE", createdAt: { gte: since }, job: { is: { employeeId } } },
    orderBy: { createdAt: "asc" },
    select: {
      createdAt: true,
      assignedTaskId: true,
      job: { select: { endDay: true, estimateHours: true } },
    },
  });

  // Work that was finished, reopened and finished again is one piece of work,
  // counted by the time it finally landed — which is also the honest answer to
  // whether it met its date.
  const finished = new Map<string, Finished>();

  for (const row of entryDone) {
    if (!row.entryId) continue;
    finished.set(`entry:${row.entryId}`, {
      key: `entry:${row.entryId}`,
      entryId: row.entryId,
      jobId: null,
      doneAt: row.createdAt,
      // No deadline means nothing was agreed, so there is nothing to have met.
      onTime: row.entry?.dueAt ? row.createdAt <= row.entry.dueAt : null,
      estimateHours: row.entry?.estimateHours ?? null,
    });
  }

  for (const row of jobDone) {
    if (!row.assignedTaskId) continue;
    const endDay = dateToDayKey(row.job?.endDay);
    finished.set(`job:${row.assignedTaskId}`, {
      key: `job:${row.assignedTaskId}`,
      entryId: null,
      jobId: row.assignedTaskId,
      doneAt: row.createdAt,
      // A job runs to the end of its last day, and which day that is is a
      // calendar question where the studio is, not where the server is.
      onTime: endDay ? dayKeyIn(timezone, row.createdAt) <= endDay : null,
      estimateHours: row.job?.estimateHours ?? null,
    });
  }

  const work = [...finished.values()];
  const delivery: DeliveryFact[] = work.map((item) => ({ onTime: item.onTime }));

  // How long the work actually took: from the first time it was started to the
  // moment it was accepted. The start may well be older than the window, so it
  // is looked for without one.
  const wanted = work.filter((item) => (item.estimateHours ?? 0) > 0);
  const estimates: EstimateFact[] = [];

  if (wanted.length > 0) {
    const starts = await prisma.taskStateChange.findMany({
      where: {
        toState: "IN_PROGRESS",
        OR: [
          { entryId: { in: wanted.map((item) => item.entryId).filter((id): id is string => id !== null) } },
          { assignedTaskId: { in: wanted.map((item) => item.jobId).filter((id): id is string => id !== null) } },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: { entryId: true, assignedTaskId: true, createdAt: true },
    });

    const firstStart = new Map<string, Date>();
    for (const start of starts) {
      const key = start.entryId ? `entry:${start.entryId}` : `job:${start.assignedTaskId}`;
      if (!firstStart.has(key)) firstStart.set(key, start.createdAt);
    }

    for (const item of wanted) {
      const started = firstStart.get(item.key);
      if (!started) continue;

      const actualMinutes = Math.round((item.doneAt.getTime() - started.getTime()) / 60000);
      if (actualMinutes <= 0) continue;

      estimates.push({ estimatedMinutes: Math.round((item.estimateHours ?? 0) * 60), actualMinutes });
    }
  }

  // What the review made of it. A submission carries the employee who sent it,
  // so this needs no ownership rule — it is already their own attempt.
  const submissions = await prisma.taskSubmission.findMany({
    where: { employeeId, createdAt: { gte: since }, status: { not: "PENDING" } },
    orderBy: { createdAt: "asc" },
    select: { entryId: true, assignedTaskId: true, status: true },
  });

  const attemptsByWork = new Map<string, string[]>();
  for (const submission of submissions) {
    const key = submission.entryId ? `entry:${submission.entryId}` : `job:${submission.assignedTaskId}`;
    attemptsByWork.set(key, [...(attemptsByWork.get(key) ?? []), submission.status]);
  }

  const reviews: ReviewFact[] = [...attemptsByWork.values()]
    // Only work that was actually settled: something still going back and forth
    // has no verdict yet, and counting it as a failure would be one.
    .filter((attempts) => attempts.includes("APPROVED"))
    .map((attempts) => ({
      acceptedFirstTime: attempts[0] === "APPROVED",
      sendBacks: attempts.filter((status) => status === "REJECTED").length,
    }));

  // Time lost waiting on somebody else: from the moment they said they were
  // blocked to the next thing that happened to that work, or to now if it is
  // still stuck. Both ends are recorded events, and neither is a judgement
  // about the person waiting.
  const blockedAnswers = await prisma.scheduledFollowUp.findMany({
    where: { employeeId, answer: "blocked", answeredAt: { gte: since } },
    orderBy: { answeredAt: "asc" },
    select: { answeredAt: true, entryId: true, jobId: true },
  });

  const blocked: BlockedFact[] = [];

  if (blockedAnswers.length > 0) {
    const earliest = blockedAnswers[0].answeredAt ?? since;
    const moves = await prisma.taskStateChange.findMany({
      where: {
        createdAt: { gt: earliest },
        OR: [
          { entryId: { in: blockedAnswers.map((row) => row.entryId).filter((id): id is string => id !== null) } },
          { assignedTaskId: { in: blockedAnswers.map((row) => row.jobId).filter((id): id is string => id !== null) } },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: { entryId: true, assignedTaskId: true, createdAt: true },
    });

    const now = new Date();
    for (const answer of blockedAnswers) {
      if (!answer.answeredAt) continue;

      const key = answer.entryId ? `entry:${answer.entryId}` : answer.jobId ? `job:${answer.jobId}` : null;
      const freed = key
        ? moves.find(
            (move) =>
              (move.entryId ? `entry:${move.entryId}` : `job:${move.assignedTaskId}`) === key &&
              move.createdAt > answer.answeredAt!
          )
        : undefined;

      // Still blocked counts up to now: waiting that has not ended is the
      // waiting most worth seeing.
      const until = freed?.createdAt ?? now;
      blocked.push({ minutesWaiting: Math.round((until.getTime() - answer.answeredAt.getTime()) / 60000) });
    }
  }

  return {
    onTime: deliveryAdherence(delivery),
    acceptedFirstTime: firstReviewAcceptance(reviews),
    rework: reworkRate(reviews),
    blockedWaiting: waitingOnBlockers(blocked),
    estimates: estimateAccuracy(estimates),
  };
}
