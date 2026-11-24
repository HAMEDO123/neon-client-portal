import type { PayBasis } from "@/generated/prisma/enums";
import { hourlyRate } from "@/lib/payroll";
import { isWorkingDay, minutesOf, nextWorkingDay, type WorkHours } from "@/lib/work-hours";

// Money taken off for a reason: the manager's own cutoffs, and the studio's
// rule that a task not handed in by 11:59 PM costs an hour's pay.
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
// - A job given too late in the day to be finished in time is not charged.
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

type Handover = { createdAt: Date; reviewedAt: Date | null; status: "PENDING" | "APPROVED" | "REJECTED" };

/**
 * Whether a job had been handed in at the cutoff — read from when it was
 * handed in, not from its state now, because the pass that charges a day can
 * run after midnight (lastDayToCharge) and work sent at 00:20 was not in by
 * 23:59. A hand-in sent back before the cutoff does not count; one with no
 * record of a hand-in is judged by its state, the benefit of the doubt.
 */
export function handedInBy(
  task: { state: State; completedAt: Date | null; submissions: Handover[] },
  cutoffAt: Date
) {
  const by = cutoffAt.getTime();
  if (task.submissions.length === 0) return handedIn(task.state);
  if (task.state === "DONE" && task.completedAt && task.completedAt.getTime() <= by) return true;
  return task.submissions.some(
    (sub) =>
      sub.createdAt.getTime() <= by &&
      !(sub.status === "REJECTED" && sub.reviewedAt && sub.reviewedAt.getTime() <= by)
  );
}

/** Late at the cutoff: chargeable, with "handed in" judged as of 23:59. */
export function lateAt(
  task: { state: State; createdAt: Date; siteVisitId: string | null; completedAt: Date | null; submissions: Handover[] },
  cutoffAt: Date
) {
  if (handedInBy(task, cutoffAt)) return false;
  return chargeable({ ...task, state: "IN_PROGRESS" }, cutoffAt);
}

/** How many times a job had been sent back by the cutoff — its charge's round. */
export function roundAt(submissions: Handover[], cutoffAt: Date) {
  return submissions.filter(
    (sub) => sub.status === "REJECTED" && sub.reviewedAt && sub.reviewedAt.getTime() <= cutoffAt.getTime()
  ).length;
}

/**
 * The days a scheduler pass charges. The cutoff is 23:59 and the scheduler
 * comes round every ten minutes, so "charge from 23:59 until midnight" is a
 * one-minute window it almost never landed in: from 25 Oct to 21 Nov 2026
 * nobody was charged at all. So every pass also charges the day before, and
 * today once its 23:59 has come. Each charge is keyed, so it lands once.
 */
export function daysToCharge(todayKey: string, phase: "before" | "warn" | "charge", previousDayKey: string) {
  return phase === "charge" ? [previousDayKey, todayKey] : [previousDayKey];
}

/**
 * The first day a job sent back becomes due again. The owner, 2026-11-19:
 * "just for today all rejected gets charged, from tomorrow gets due for the
 * same day" — so a job sent back on the 19th keeps its date.
 */
export const REDEPLOY_FROM = "2026-11-20";

export function redeploysOn(dayKey: string) {
  return dayKey >= REDEPLOY_FROM;
}

/**
 * The day a job sent back is due again (asked for on 2026-11-19: "make the
 * rejected task redeploy at the same day"). Before this a job sent back after
 * its day had nothing left to be late for: the cutoff only reads jobs due
 * today, so every job sent back sat in progress, uncharged, for ever.
 *
 * The same day it was sent back, whatever the hour and whatever it was due
 * before — the owner, 2026-11-21: "it will be charged if not done again before
 * 12 am of the same day the tasks has been rejected". Until then a job sent
 * back after 8:59 PM went to the next working day (the three hours' notice a
 * new job gets), and one due later kept its later day. Only a day the studio
 * does not work still moves it on, since no cutoff runs on such a day.
 */
export function redeployDay(hours: WorkHours, todayKey: string) {
  return isWorkingDay(hours, todayKey) ? todayKey : nextWorkingDay(hours, todayKey);
}

/**
 * From this day a job not handed in by 11:59 PM is charged its hour and then
 * comes back on the next working day as a new job, not as a late one. The
 * owner, 2026-11-24: "بدي اياه يرجع ينزل ثاني يوم مش late، ينزل زي كأنه انا
 * نزلته". Each day it stays out is its own hour.
 */
export const CARRY_FROM = "2026-11-24";

export function carriesOver(dayKey: string) {
  return dayKey >= CARRY_FROM;
}

/** The day a job not handed in comes back: the next day the studio works. */
export function carryDay(hours: WorkHours, dayKey: string) {
  return nextWorkingDay(hours, dayKey);
}

/**
 * The key a late job's charge is written under. From `CARRY_FROM` a job can be
 * due — and late — on many days, so the key is the job and the day: once a day,
 * however often the scheduler comes round. Days before it keep the old key, so
 * nothing already charged is charged twice.
 */
export function lateTaskKey(taskId: string, dayKey: string, round = 0) {
  return carriesOver(dayKey) ? `TASK:${taskId}:DAY:${dayKey}` : taskDedupe(taskId, round);
}

/** What the person is told when a job comes back: the words a new job is handed out with. */
export function carriedCopy(title: string, dueKey: string, todayKey: string) {
  return {
    title: "New Task Assigned",
    message: `${title} — ${dueKey === todayKey ? "today's job" : "tomorrow's job"}.`,
  };
}

export const carriedKey = (taskId: string, dueKey: string) => `CARRIED:${taskId}:${dueKey}`;

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
    message: `${count === 1 ? "One hour's pay" : `${count} hours' pay`} (${money(amount)}) was taken off. Talk to the manager if that is not right.`,
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
/**
 * One charge per task, ever — whatever is done to its dates afterwards — and
 * one more each time it is sent back (`round`, how many times it has been):
 * being sent back makes it due again, so not handing it in again is a new
 * thing to be late for. Round 0 keeps the old key, so nothing already charged
 * is charged twice.
 */
export const taskDedupe = (taskId: string, round = 0) => (round > 0 ? `TASK:${taskId}:SENT-BACK:${round}` : `TASK:${taskId}`);
/**
 * The charge for being sent back at all, one per sending-back. "REJECTED:" is
 * the key the first of these were written under by hand on 2026-11-19, so the
 * code and those rows can never charge the same sending-back twice.
 */
export const sentBackDedupe = (submissionId: string) => `REJECTED:${submissionId}`;

/**
 * The only day on which being sent back costs an hour by itself. The owner
 * asked for it for that day and no other ("no just for today man"); on every
 * other day a job sent back costs nothing until it is not handed in again by
 * 11:59 PM.
 */
export const SENT_BACK_CHARGE_DAY = "2026-11-19";

export function chargesForSendingBack(dayKey: string) {
  return dayKey === SENT_BACK_CHARGE_DAY;
}
