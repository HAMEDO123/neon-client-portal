import { prisma } from "@/lib/db";
import { dispatchNotification } from "@/lib/notifications/engine";
import { DASHBOARD_PATH, taskUrl } from "@/lib/notifications/types";
import { dueFollowUps, markAsked, markSkipped } from "@/lib/follow-up-queue";
import type { FollowUpKind } from "@/lib/follow-ups";
import { getTimezone } from "@/lib/settings";

// Asking the questions that have come due.
//
// The poller may run as often as the scheduler likes: every question carries
// the dedupe key it was written with, so the notification engine's unique index
// refuses a second copy even if two runs overlap. `askedAt` is stamped on every
// question that goes out, and `skippedAt` on one closed without being asked, so
// neither is considered again.
//
// What is deliberately not here: any judgement about the work. A follow-up asks;
// it does not decide that something was late, or unfinished, or that silence
// means anybody failed to do anything.

const COPY: Record<FollowUpKind, { title: string; message: (what: string) => string }> = {
  "day-start": {
    title: "Your day is ready",
    message: () => "Have a look at today's plan, and say if anything is missing before you start.",
  },
  "block-start": {
    title: "Time to start",
    message: (what) => `${what} is due to start now. Tap to say you have started, or that something is in the way.`,
  },
  "block-middle": {
    title: "How is it going?",
    message: (what) => `You are about halfway through ${what}. Anything holding it up?`,
  },
  "block-end": {
    title: "How did it go?",
    message: (what) => `${what} was planned to finish about now. Done, partly done, or held up?`,
  },
  "day-end": {
    title: "That is the day",
    message: () => "Tell us what got done and what did not, so tomorrow is planned on what is real.",
  },
};

/** Where the question should take somebody who taps it. */
function urlFor(followUp: { entryId: string | null; jobId: string | null }): string {
  if (followUp.entryId) return taskUrl(followUp.entryId);
  if (followUp.jobId) return `/employee/assigned/${followUp.jobId}`;
  return DASHBOARD_PATH;
}

/** The name of the work a question is about, as the employee would know it. */
async function nameOf(followUp: { entryId: string | null; jobId: string | null }): Promise<string> {
  if (followUp.entryId) {
    const entry = await prisma.projectTaskEntry.findUnique({
      where: { id: followUp.entryId },
      select: { task: { select: { name: true } }, project: { select: { name: true } } },
    });
    if (entry) return `${entry.task.name} (${entry.project.name})`;
  }

  if (followUp.jobId) {
    const job = await prisma.assignedTask.findUnique({
      where: { id: followUp.jobId },
      select: { title: true },
    });
    if (job) return job.title;
  }

  return "the next thing on your day";
}

/**
 * Sends every question that has come due.
 *
 * The world is re-read before each one: a task that has since been finished, or
 * a block whose work no longer exists, is closed as skipped rather than chasing
 * somebody about something they have already done — never marked asked, which
 * the day board would count as a question left unanswered.
 *
 * Only questions about today are considered, in the company's timezone — see
 * `dueFollowUps`. The caller usually knows the timezone already; without it,
 * it is read from settings.
 */
export async function runFollowUps(now: Date = new Date(), timeZone?: string) {
  const due = await dueFollowUps(now, { timeZone: timeZone ?? (await getTimezone()) });
  let sent = 0;
  let skipped = 0;

  for (const followUp of due) {
    // Already finished? Then there is nothing to ask.
    if (followUp.entryId) {
      const entry = await prisma.projectTaskEntry.findUnique({
        where: { id: followUp.entryId },
        select: { state: true },
      });
      if (!entry || entry.state === "DONE" || entry.state === "SUBMITTED") {
        await markSkipped(followUp.id, entry ? `task-${entry.state.toLowerCase()}` : "task-gone");
        skipped += 1;
        continue;
      }
    }

    const copy = COPY[followUp.kind];
    if (!copy) {
      await markSkipped(followUp.id, "unknown-kind");
      skipped += 1;
      continue;
    }

    const what = await nameOf(followUp);

    const result = await dispatchNotification({
      employeeId: followUp.employeeId,
      // The day's own running commentary: preferences do not silence it, the
      // way a warning is not silenced.
      type: "SYSTEM_NOTIFICATION",
      title: copy.title,
      message: copy.message(what),
      url: urlFor(followUp),
      entryId: followUp.entryId,
      dedupeKey: followUp.dedupeKey,
      metadata: { followUpId: followUp.id, kind: followUp.kind },
    }).catch(() => null);

    // Stamped whatever happened: a question that could not be delivered is not
    // one to keep re-sending on every run.
    await markAsked(followUp.id);
    if (result?.created) sent += 1;
    else skipped += 1;
  }

  return { due: due.length, sent, skipped };
}
