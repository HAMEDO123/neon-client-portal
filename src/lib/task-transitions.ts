import type { TaskState } from "@/generated/prisma/enums";

// Who may move a task where, and what that move is called.
//
// Pure on purpose: these are the rules, and they are worth reading in one place
// rather than inferring from six actions scattered across the codebase. The
// board's five states already say what the studio needs — TODO is pending,
// SUBMITTED is with the manager for review, DONE is approved — so nothing new
// is invented here; the transitions between them are simply written down.
//
// The rule underneath all of them: a state is a claim about the work, and only
// somebody entitled to make that claim may write it. Time passing is not a
// claim, which is why automation may not move anything at all.

export type Actor =
  /** The person the work belongs to. */
  | "employee"
  /** The manager, in the admin portal. */
  | "manager"
  /** A job, a poller, anything with nobody behind it. */
  | "system";

export type Move = { ok: true } | { ok: false; reason: string };

const ALLOW = { ok: true } as const;
const refuse = (reason: string): Move => ({ ok: false, reason });

/** What an employee may set directly, without sending anything. */
export const EMPLOYEE_DIRECT: TaskState[] = ["TODO", "IN_PROGRESS"];

/** What the manager sets by hand on the board. */
export const MANAGER_DIRECT: TaskState[] = ["TODO", "IN_PROGRESS", "DONE", "TOMORROW"];

/**
 * Whether this move is allowed, and if not, why — in words worth showing.
 *
 * `submitting` marks the one move an employee makes by handing work in rather
 * than by choosing a state: it is the proof that carries it to review, never a
 * tap.
 */
export function canMove(from: TaskState, to: TaskState, actor: Actor, submitting = false): Move {
  if (from === to) return refuse("It is already in that state.");

  if (actor === "system") {
    // A planned block ending is not evidence of anything. Automation asks; it
    // does not decide.
    return refuse("Automation does not move work; only people do.");
  }

  if (actor === "employee") {
    if (to === "DONE") return refuse("Only the manager marks work done, after reviewing it.");
    if (to === "TOMORROW") return refuse("Scheduling is the manager's.");

    if (to === "SUBMITTED") {
      if (!submitting) return refuse("Send the finished work as proof — that is what puts it in review.");
      if (from === "DONE") return refuse("That work is already approved.");
      return ALLOW;
    }

    if (from === "SUBMITTED") return refuse("That work is with the manager now.");
    if (from === "DONE") return refuse("That work is approved; ask the manager to reopen it.");

    return EMPLOYEE_DIRECT.includes(to) ? ALLOW : refuse("That status cannot be set from the employee portal.");
  }

  // The manager.
  if (to === "SUBMITTED") return refuse("Only the person doing the work puts it in review.");
  return MANAGER_DIRECT.includes(to) ? ALLOW : refuse("That is not a state the board sets.");
}

/**
 * The move as a line in the record. Written from the states rather than from
 * whoever happened to trigger it, so the log reads the same however it was
 * caused.
 */
export function describeMove(from: TaskState, to: TaskState): string {
  if (to === "SUBMITTED") return "sent for review";
  if (from === "SUBMITTED" && to === "IN_PROGRESS") return "sent back for changes";
  if (to === "DONE") return "approved";
  if (from === "DONE") return "reopened";
  if (to === "IN_PROGRESS") return "started";
  if (to === "TOMORROW") return "moved to tomorrow";
  if (to === "TODO") return "put back to pending";
  return "changed";
}

/** Whether reaching this state needs somebody to have approved it. */
export function needsApproval(to: TaskState): boolean {
  return to === "DONE";
}

/**
 * Whether a task in this state is finished as far as the employee is concerned.
 * Used to keep follow-ups away from work that is already handed in.
 */
export function isWithTheManager(state: TaskState): boolean {
  return state === "SUBMITTED" || state === "DONE";
}
