import type { PayBasis } from "@/generated/prisma/enums";
import { hourlyRate } from "@/lib/payroll";
import { minutesOf } from "@/lib/work-hours";

// Money taken off for a reason: the manager's own cutoffs, and the studio's
// rule that a task not handed in by nine in the evening costs an hour's pay.
//
// The rule, as the studio asked for it: every job due today that has not been
// handed in — sent for review, or approved — by 23:59 costs its owner one
// hour. What keeps that from being unfair is as much a part of it as the
// hour, so it lives here, pure and tested, rather than in the job that runs it:
//
// - Everybody is told the rule exists before any day counts.
// - Everybody with work still out is warned an hour before.
// - Nobody is charged on an evening they were not warned on: an evening the
//   server could not warn is an evening it could not take the work in either.
// - A job given too late in the day to be finished by nine is not charged.
// - A task is charged once, ever, and the manager can take any charge back.

/** The time, on the studio's clock, a day's work has to be handed in by. */
export const CUTOFF_TIME = "23:59";
/** The time the warning goes out: an hour before. */
export const WARN_TIME = "22:59";
/**
 * The same two as minutes past midnight, which is what the phase is decided on.
 *
 * A whole hour was enough while the cutoff was 9 PM. The end of the day is
 * 23:59, and an hour-based rule cannot say that: "24:00" is not a time any
 * clock shows, and `hour >= 24` is a comparison that never becomes true — the
 * charge would simply never run.
 */
export const CUTOFF_MINUTES = minutesOf(CUTOFF_TIME) ?? 0;
export const WARN_MINUTES = minutesOf(WARN_TIME) ?? 0;
/** What one task not handed in costs, in hours of pay. */
export const HOURS_PER_TASK = 1;
/** A job given later than this many hours before the cutoff is not charged that evening. */
export const NOTICE_HOURS = 3;

export const CUTOFF_SETTING = "task_cutoff";
export const CUTOFF_ANNOUNCED = "task_cutoff_announced_at";

/** On unless it was switched off. The studio asked for it, so unset means on. */
export function cutoffOn(setting: string | null | undefined) {
  return setting !== "false";
}

type State = "TODO" | "IN_PROGRESS" | "SUBMITTED" | "DONE" | "TOMORROW";

/** Handed in: with the manager, or approved. What happens to it next is theirs. */
export function handedIn(state: State) {
  return state === "SUBMITTED" || state === "DONE";
}

/**
 * Where an evening stands: nothing yet, the warning, or past the cutoff.
 *
 * Takes minutes past midnight on the studio's clock, not an hour — see
 * CUTOFF_MINUTES.
 */
export function cutoffPhase(minutes: number): "before" | "warn" | "charge" {
  if (minutes >= CUTOFF_MINUTES) return "charge";
  return minutes >= WARN_MINUTES ? "warn" : "before";
}

/**
 * Whether a day counts for the rule: only days after the one it was announced
 * on. Told at noon, nobody is charged that evening — the first evening that
 * counts is the next one.
 */
export function dayCounts(dayKey: string, announcedDayKey: string | null) {
  return announcedDayKey != null && dayKey > announcedDayKey;
}

/**
 * Whether one job is charged at the cutoff.
 *
 * A site visit is not: it is finished by writing it up in the diary, and has
 * its own chase. A job handed out within `NOTICE_HOURS` of the cutoff is not
 * either — "by nine tonight" said at half past eight is not a deadline.
 */
export function chargeable(
  task: { state: State; createdAt: Date; siteVisitId: string | null },
  cutoffAt: Date
) {
  if (handedIn(task.state) || task.siteVisitId) return false;
  return task.createdAt.getTime() <= cutoffAt.getTime() - NOTICE_HOURS * 60 * 60 * 1000;
}

/** An hour of somebody's pay, to the fils, as payroll works it out. */
export function hoursAsMoney(salaryAmount: number | null | undefined, basis: PayBasis, hours: number) {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(hourlyRate(salaryAmount ?? 0, basis) * hours * 1000) / 1000;
}

/**
 * What the manager typed for a cutoff of their own: hours of pay, or an
 * amount. Null when it is neither — `Number("")` is 0, and a form with both
 * boxes empty must not become a deduction of nothing with a reason attached.
 */
export function readManualCutoff(input: { hours: unknown; amount: unknown }): { hours: number | null; amount: number | null } | null {
  const read = (value: unknown) => {
    const text = String(value ?? "").trim();
    if (!text) return null;
    const figure = Number(text);
    return Number.isFinite(figure) && figure > 0 ? Math.round(figure * 1000) / 1000 : null;
  };
  const hours = read(input.hours);
  const amount = read(input.amount);
  if (hours == null && amount == null) return null;
  // Hours win when both were typed: the amount is then worked out from them.
  return hours != null ? { hours: Math.min(hours, 24 * 31), amount: null } : { hours: null, amount };
}

// --- What is said, and once each ---------------------------------------------

const money = (amount: number) => `${amount.toFixed(2)} JOD`;
const tasks = (count: number) => (count === 1 ? "1 task" : `${count} tasks`);

export function noticeCopy() {
  return {
    title: "Tasks are due by 11:59 PM",
    message:
      "From tomorrow, a task due that day and not handed in by 11:59 PM costs one hour's pay. You will be warned at 10:59 PM if anything is still out.",
  };
}

export function warningCopy(count: number) {
  return {
    title: `${tasks(count)} not handed in yet`,
    message: `Due today. Send ${count === 1 ? "it" : "them"} for review before 11:59 PM — after that each one costs one hour's pay.`,
  };
}

export function chargeCopy(count: number, amount: number) {
  return {
    title: `${tasks(count)} not handed in by 11:59 PM`,
    message: `${count === 1 ? "One hour's pay" : `${count} hours' pay`} (${money(amount)}) was taken off for today. Talk to the manager if that is not right.`,
  };
}

export function managerCopy(people: { name: string; count: number }[]) {
  const total = people.reduce((sum, person) => sum + person.count, 0);
  return {
    title: `${tasks(total)} not handed in by 11:59 PM`,
    message: `One hour each was taken off: ${people.map((person) => `${person.name} (${person.count})`).join(", ")}. Any of them can be taken back on the payroll page.`,
  };
}

export function manualCopy(amount: number, reason: string) {
  return { title: "A deduction was added", message: `${money(amount)} — ${reason}` };
}

export function takenBackCopy(amount: number, reason: string) {
  return { title: "A deduction was taken back", message: `${money(amount)} — ${reason}` };
}

export const noticeKey = (employeeId: string, stamp: string) => `TASK_CUTOFF_NOTICE:${employeeId}:${stamp}`;
export const warningKey = (employeeId: string, dayKey: string) => `TASK_CUTOFF_WARN:${employeeId}:${dayKey}`;
export const chargeKey = (employeeId: string, dayKey: string) => `TASK_CUTOFF_CHARGE:${employeeId}:${dayKey}`;
export const managerKey = (dayKey: string) => `TASK_CUTOFF_MANAGER:${dayKey}`;
/** One charge per task, ever — whatever is done to its dates afterwards. */
export const taskDedupe = (taskId: string) => `TASK:${taskId}`;
