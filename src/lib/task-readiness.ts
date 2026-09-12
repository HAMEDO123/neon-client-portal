import type { TaskState } from "@/generated/prisma/enums";

// Whether a task can be picked up, and if not, what it is waiting for.
//
// "Ready", "blocked" and "waiting" are not states anybody sets: they are read
// off the facts — the tasks this one waits for, and whether somebody wrote down
// a reason it cannot move. Keeping them derived means the board's five states
// stay as they are, a dependency finishing makes the next task ready with no
// second write, and nothing can be blocked without a reason on the record.
//
// This is the answer every later piece leans on: what to start next, who to
// chase, and what to say in a summary.

export type Dependency = {
  /** The task being waited for, as it should be named to a person. */
  name: string;
  done: boolean;
};

export type TaskFacts = {
  state: TaskState;
  blockedReason: string | null;
  /** Who can clear the blocker, where somebody has been named. */
  blockedByName: string | null;
  dependencies: Dependency[];
};

export type Readiness =
  | { status: "done" }
  /** Sent for review: the manager owns the next move, not the employee. */
  | { status: "in-review" }
  | { status: "blocked"; reason: string; ownerName: string | null }
  /** Waiting on work that has not finished yet. */
  | { status: "waiting"; on: string[] }
  | { status: "ready" };

/**
 * The precedence matters: finished work is finished whatever else is recorded
 * against it, work with the manager is theirs to move, a written blocker beats
 * a dependency (somebody looked and said why), and a task is ready only when
 * nothing is left to wait for.
 */
export function readinessOf(facts: TaskFacts): Readiness {
  if (facts.state === "DONE") return { status: "done" };
  if (facts.state === "SUBMITTED") return { status: "in-review" };

  const reason = facts.blockedReason?.trim();
  if (reason) return { status: "blocked", reason, ownerName: facts.blockedByName };

  const waitingOn = facts.dependencies.filter((dependency) => !dependency.done).map((d) => d.name);
  if (waitingOn.length > 0) return { status: "waiting", on: waitingOn };

  return { status: "ready" };
}

/** What the badge on the task says. */
export function readinessLabel(readiness: Readiness) {
  switch (readiness.status) {
    case "done":
      return "Done";
    case "in-review":
      return "Waiting for approval";
    case "blocked":
      return "Blocked";
    case "waiting":
      return readiness.on.length === 1 ? `Waiting on ${readiness.on[0]}` : `Waiting on ${readiness.on.length} tasks`;
    case "ready":
      return "Ready";
  }
}

/**
 * The line under it: why, in the words somebody wrote down.
 *
 * The reason is kept apart from the sentence around it. Reasons here are as
 * often Arabic as English, and gluing the two together on one line leaves the
 * words in an order neither language reads — so a caller renders the reason in
 * its own direction and puts `who` beside it.
 */
export function readinessReason(readiness: Readiness): { reason: string; who: string | null } | null {
  switch (readiness.status) {
    case "blocked":
      return { reason: readiness.reason, who: readiness.ownerName };
    case "waiting":
      return {
        reason: `Starts when ${readiness.on.join(", ")} ${readiness.on.length === 1 ? "is" : "are"} finished.`,
        who: null,
      };
    case "in-review":
      return { reason: "Sent for review; waiting on the manager.", who: null };
    default:
      return null;
  }
}

/** Whether somebody can start on it right now. */
export function isStartable(readiness: Readiness) {
  return readiness.status === "ready";
}

/** The estimate as a person would say it. Null means nobody has guessed yet. */
export function effortLabel(hours: number | null | undefined) {
  if (hours == null || !Number.isFinite(hours) || hours <= 0) return null;
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  const rounded = Math.round(hours * 2) / 2;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} h`;
}
