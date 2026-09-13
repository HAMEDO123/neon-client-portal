import { overloaded, unplanned, type PersonDay } from "@/lib/day-board";

// Rules the studio sets for itself: when to ask, when to tell, when to escalate.
//
// Pure on purpose, and deliberately narrow. Everything here decides is *whether
// to say something and to whom* — never what the work is. The conditions are
// not re-derived either: they are read off `PersonDay`, the same fact bundle the
// manager's day board is built from, so "more planned than the day holds" means
// exactly one thing in this codebase and changing it changes both at once.
//
// The line this module exists to hold: automation may ask, tell and escalate.
// It may not move work. `canMove(..., "system")` in lib/task-transitions.ts
// already refuses every transition a job could attempt; the vocabulary here has
// no state change in it at all, so there is nothing to refuse in the first
// place. A rule that could tick something done would turn a schedule into
// evidence, and a schedule is not evidence that anything happened.

export type Trigger =
  /** Nothing was ever put on this person's day. */
  | "no-plan"
  /** More planned than the day holds. */
  | "overloaded"
  /** Work stuck on somebody else. */
  | "blocked"
  /** They said they started, and the board never moved. */
  | "contradiction"
  /** An answer that needs the manager — blocked, needs information, more time. */
  | "waiting-on-manager"
  /** Questions asked and still unanswered. */
  | "unanswered";

/** Who hears about it. Never "nobody", and never the whole team. */
export type Recipient = "the-person" | "the-manager";

/**
 * What a rule may do.
 *
 * Three verbs, all of them speech. There is deliberately no fourth for moving,
 * ticking, approving or reassigning work.
 */
export type Action = "ask" | "tell" | "escalate";

export type Rule = {
  id: string;
  /** What the manager called it. */
  name: string;
  trigger: Trigger;
  /** How many of the thing must be true before it counts at all. */
  atLeast: number;
  action: Action;
  recipient: Recipient;
  /** Minutes the condition must have held before anything is said. */
  graceMinutes: number;
  /** Minutes before this rule may speak about this person again. */
  cooldownMinutes: number;
  /** Minutes after which an unresolved one goes to the manager. Null: never. */
  escalateAfterMinutes: number | null;
  enabled: boolean;
};

/** What the runner remembers about one rule and one person. */
export const TRIGGERS: Trigger[] = [
  "no-plan",
  "overloaded",
  "blocked",
  "contradiction",
  "waiting-on-manager",
  "unanswered",
];

export const ACTIONS: Action[] = ["ask", "tell", "escalate"];
export const RECIPIENTS: Recipient[] = ["the-person", "the-manager"];

/**
 * What each condition is called where a person reads it.
 *
 * Here rather than in the component, so the runner, the settings screen and the
 * preview all call the same thing by the same name — and so a trigger added to
 * the type has to be named before it will compile.
 */
export const TRIGGER_LABEL: Record<Trigger, string> = {
  "no-plan": "No plan on their day",
  overloaded: "More planned than the day holds",
  blocked: "Work waiting on somebody else",
  contradiction: "Said started, board still pending",
  "waiting-on-manager": "An answer waiting on the manager",
  unanswered: "Questions nobody has answered",
};

export type RuleState = {
  /** When this condition was first seen true for them, if it still is. */
  since: Date | null;
  /** When this rule last actually said something about them. */
  lastActedAt: Date | null;
};

export type Firing =
  | { fires: false; why: string; count: number }
  | {
      fires: true;
      action: Action;
      recipient: Recipient;
      /** Whether this one went to the manager because it had gone on too long. */
      escalated: boolean;
      count: number;
      /** How long the condition has held, in minutes. */
      heldMinutes: number;
    };

/**
 * Automation never moves work.
 *
 * Written as a function rather than left implicit, in the same spirit as
 * `submissionClosesTask()`: it is the rule the whole module exists to protect,
 * and a rule nobody can point at is a rule somebody will eventually add a case
 * around.
 */
export function mayMoveWork(): false {
  return false;
}

/** How many of a trigger's thing are true for this person today. */
export function countFor(trigger: Trigger, day: PersonDay): number {
  switch (trigger) {
    case "no-plan":
      return unplanned(day) ? 1 : 0;
    case "overloaded":
      return overloaded(day) ? 1 : 0;
    case "blocked":
      return day.blocked.length;
    case "contradiction":
      return day.contradictions.length;
    case "waiting-on-manager":
      return day.needsManager.length;
    case "unanswered":
      return day.unanswered;
  }
}

const minutesBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / 60000);

/**
 * Whether one rule speaks about one person right now, and to whom.
 *
 * Every refusal comes back with a reason in words, because this is also what
 * the preview screen shows: a manager deciding whether to switch a rule on
 * needs to see why it would stay quiet, not just that it would.
 *
 * Grace and cooldown are both measured from moments that were recorded when
 * they happened — never from the clock alone — so a runner that runs twice in a
 * minute, or that has been asleep for an hour, behaves the same way.
 */
export function evaluate(rule: Rule, day: PersonDay, state: RuleState, now: Date, switchedOn = true): Firing {
  const count = countFor(rule.trigger, day);

  // The kill switch wins over everything, including a rule somebody just
  // enabled. One place to stop the whole thing is worth more than any rule.
  if (!switchedOn) return { fires: false, why: "Automation is switched off for the studio.", count };
  if (!rule.enabled) return { fires: false, why: "This rule is turned off.", count };

  const needed = Math.max(1, Math.round(rule.atLeast));
  if (count < needed) {
    return {
      fires: false,
      why: count === 0 ? "Not true for them right now." : `True ${count} times; this rule waits for ${needed}.`,
      count,
    };
  }

  // A condition with no recorded start has only just become true, which is the
  // same as nought minutes — never "long enough", so nothing fires on its first
  // sighting unless the rule asks for no grace at all.
  const heldMinutes = state.since ? Math.max(0, minutesBetween(state.since, now)) : 0;
  const grace = Math.max(0, Math.round(rule.graceMinutes));
  if (heldMinutes < grace) {
    return {
      fires: false,
      why: `True for ${heldMinutes} minutes; this rule waits ${grace}.`,
      count,
    };
  }

  const cooldown = Math.max(0, Math.round(rule.cooldownMinutes));
  if (state.lastActedAt) {
    const quiet = Math.max(0, minutesBetween(state.lastActedAt, now));
    if (quiet < cooldown) {
      return {
        fires: false,
        why: `Said ${quiet} minutes ago; this rule stays quiet for ${cooldown}.`,
        count,
      };
    }
  }

  // Gone on long enough that the person it was aimed at is no longer the right
  // audience. Escalating redirects it — it does not send a second copy.
  const escalated =
    rule.escalateAfterMinutes !== null && heldMinutes >= Math.max(0, Math.round(rule.escalateAfterMinutes));

  return {
    fires: true,
    action: escalated ? "escalate" : rule.action,
    recipient: escalated ? "the-manager" : rule.recipient,
    escalated,
    count,
    heldMinutes,
  };
}

/**
 * The key that makes a rule speak once.
 *
 * Derived from the rule, the person, the day and whether it escalated — never
 * from the clock, so two overlapping runs produce the same key and the
 * notification engine's unique index refuses the second. An escalation earns its
 * own key, because it is a different thing to say to a different person.
 */
export function ruleKey(rule: Rule, employeeId: string, dayKey: string, escalated: boolean): string {
  return `RULE:${rule.id}:${employeeId}:${dayKey}${escalated ? ":escalated" : ""}`;
}

/** What a rule would do, in a sentence, for the preview before switching it on. */
export function describeFiring(rule: Rule, firing: Firing): string {
  if (!firing.fires) return `${rule.name}: quiet — ${firing.why}`;

  const who = firing.recipient === "the-manager" ? "the manager" : "them";
  const verb = firing.action === "ask" ? "asks" : firing.action === "tell" ? "tells" : "escalates to";

  return firing.escalated
    ? `${rule.name}: ${verb} ${who} — still true after ${firing.heldMinutes} minutes`
    : `${rule.name}: ${verb} ${who} — true ${firing.count === 1 ? "now" : `${firing.count} times`}`;
}
