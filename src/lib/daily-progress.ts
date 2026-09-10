import { holderKey, ownerOf } from "@/lib/ownership";
import { countStates, type StateCounts } from "@/lib/progress";
import { shiftDayKey } from "@/lib/time";
import { daysBetween } from "@/lib/week";

// A person's day, counted the same way wherever it is shown.
//
// An employee's phone shows "Today's progress"; the manager's analytics shows
// the same day for the whole team. Both count through here, so a person and
// their manager never see two numbers for one day. A day's list is the board
// steps scheduled on it and the week-table jobs that are on it. Cells marked
// "not counted" stay out, as they do on the board and in the monthly figure.
// Pure — the queries fetch, this decides, the tests pin it.

export type JobOnList = { startKey: string; endKey: string; state: string };

/**
 * Whether a job is on the list for `dayKey`: from its first day through its
 * last, and after that for as long as it is still open — unfinished work does
 * not stop being that day's by being late.
 */
export function jobOnDay(job: JobOnList, dayKey: string) {
  return job.startKey <= dayKey && (job.state !== "DONE" || job.endKey >= dayKey);
}

/** One day's list by where each thing on it stands. `steps` are the board steps scheduled that day. */
export function dayCounts(
  steps: { state: string; excludedFromProgress: boolean }[],
  jobs: JobOnList[],
  dayKey: string
): StateCounts {
  return countStates([
    ...steps.filter((step) => !step.excludedFromProgress).map((step) => step.state),
    ...jobs.filter((job) => jobOnDay(job, dayKey)).map((job) => job.state),
  ]);
}

/** Several people's days added into one, for the team. */
export function sumCounts(list: StateCounts[]): StateCounts {
  return list.reduce(
    (sum, counts) => ({
      done: sum.done + counts.done,
      review: sum.review + counts.review,
      working: sum.working + counts.working,
      pending: sum.pending + counts.pending,
      total: sum.total + counts.total,
    }),
    { done: 0, review: 0, working: 0, pending: 0, total: 0 }
  );
}

/** `count` days ending on `lastKey`, oldest first. */
export function daysEnding(lastKey: string, count: number) {
  return Array.from({ length: count }, (_, index) => shiftDayKey(lastKey, index - count + 1));
}

const LONG_DAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** "Today · Thursday 10 September", "Yesterday · …", "Tomorrow · …", or the date alone. */
export function dayHeading(dayKey: string, todayKey: string) {
  const parts = Object.fromEntries(
    LONG_DAY.formatToParts(new Date(`${dayKey}T00:00:00.000Z`)).map((part) => [part.type, part.value])
  );
  const date = `${parts.weekday} ${parts.day} ${parts.month}`;
  const offset = daysBetween(todayKey, dayKey);
  if (offset === 0) return `Today · ${date}`;
  if (offset === -1) return `Yesterday · ${date}`;
  if (offset === 1) return `Tomorrow · ${date}`;
  return date;
}

export type DayStep = {
  id: string;
  state: string;
  /** The day it is scheduled on, if it has one. */
  dayKey: string | null;
  excludedFromProgress: boolean;
  assigneeId: string | null;
  projectId: string;
  projectName: string;
  stepName: string;
  stepOwnerId: string | null;
  sectionId: string | null;
};

export type DayJob = JobOnList & { id: string; employeeId: string; title: string };

export type WorkingItem = { id: string; title: string; project: string | null };

export type PersonDay = {
  /** The day being looked at — the last of `days`. */
  counts: StateCounts;
  /** Every day of the strip, oldest first. */
  history: { dayKey: string; done: number; total: number }[];
  /** What they have marked In Progress, whichever day it is on. */
  working: WorkingItem[];
};

/**
 * Everyone's days at once. `sectionHolders` maps holderKey(project, section)
 * to whoever holds that section of that project.
 */
export function groupDaily({
  employeeIds,
  steps,
  jobs,
  sectionHolders,
  days,
}: {
  employeeIds: string[];
  steps: DayStep[];
  jobs: DayJob[];
  sectionHolders: Map<string, string>;
  days: string[];
}): Map<string, PersonDay> {
  const selected = days[days.length - 1];

  const stepsBy = new Map<string, DayStep[]>();
  for (const step of steps) {
    const owner = ownerOf(
      step.assigneeId,
      { employeeId: step.stepOwnerId },
      step.sectionId ? sectionHolders.get(holderKey(step.projectId, step.sectionId)) : null
    );
    if (!owner) continue;
    const list = stepsBy.get(owner) ?? [];
    list.push(step);
    stepsBy.set(owner, list);
  }

  return new Map(
    employeeIds.map((id) => {
      const mine = stepsBy.get(id) ?? [];
      const myJobs = jobs.filter((job) => job.employeeId === id);
      const countDay = (key: string) => dayCounts(mine.filter((step) => step.dayKey === key), myJobs, key);

      const person: PersonDay = {
        counts: countDay(selected),
        history: days.map((key) => {
          const counts = countDay(key);
          return { dayKey: key, done: counts.done, total: counts.total };
        }),
        working: [
          ...mine
            .filter((step) => step.state === "IN_PROGRESS")
            .map((step) => ({ id: step.id, title: step.stepName, project: step.projectName })),
          ...myJobs
            .filter((job) => job.state === "IN_PROGRESS")
            .map((job) => ({ id: job.id, title: job.title, project: null })),
        ],
      };
      return [id, person] as const;
    })
  );
}
