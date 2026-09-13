import { prisma } from "@/lib/db";
import { notifyAdmin } from "@/lib/admin-notifications";
import { dayBoard } from "@/lib/day-board-queries";
import { dispatchNotification } from "@/lib/notifications/engine";
import { DASHBOARD_PATH } from "@/lib/notifications/types";
import { getSetting, getTimezone } from "@/lib/settings";
import { dayKeyToDate, todayKey } from "@/lib/time";
import {
  TRIGGERS,
  countFor,
  describeFiring,
  evaluate,
  ruleKey,
  type Recipient,
  type Rule,
  type Trigger,
} from "@/lib/automation";
import type { PersonDay } from "@/lib/day-board";

// Running the studio's own rules.
//
// Whether a rule speaks is decided in lib/automation.ts, where it is tested
// without a clock or a database. This is the part that reads the day, remembers
// when a condition started, and says the thing — the same shape as
// `runFollowUps`, on the same schedule, with the same guarantee: every message
// carries a key derived from the rule, the person and the day, never from the
// clock, so two overlapping runs say it once.
//
// What is deliberately absent: any write to a task. A rule cannot start, finish,
// approve or reassign anything. The worst a misconfigured rule can do is talk
// too much, and grace, cooldown and the studio-wide switch exist to bound even
// that.

/** Off unless the manager has turned it on. */
export const AUTOMATION_SWITCH_KEY = "automation_enabled";

export async function automationOn(): Promise<boolean> {
  return (await getSetting(AUTOMATION_SWITCH_KEY)) === "on";
}

/**
 * What each rule says, and to whom.
 *
 * Written here rather than typed by the manager, because the wording is where
 * this feature could do damage: every one of these reports a fact and asks a
 * question. None of them says anybody failed — least of all the silent one,
 * where the data cannot tell "did not work" from "did not reply".
 */
const COPY: Record<Trigger, { person: { title: string; message: string }; manager: (day: PersonDay) => string }> = {
  "no-plan": {
    person: { title: "No plan on your day", message: "Nothing has been put on your day yet. Anything you are already on?" },
    manager: (day) => `${day.name} has no plan on the day yet.`,
  },
  overloaded: {
    person: {
      title: "More planned than the day holds",
      message: "Your day has more on it than it fits. Say what should move, rather than working late.",
    },
    manager: (day) => `${day.name}'s day has more planned than it holds.`,
  },
  blocked: {
    person: { title: "Still blocked", message: "Something on your day is waiting on somebody else. Is it still stuck?" },
    manager: (day) =>
      `${day.name} has ${day.blocked.length} piece${day.blocked.length === 1 ? "" : "s"} of work waiting on somebody else.`,
  },
  contradiction: {
    person: {
      title: "Still showing as pending",
      message: "You said you had started, and the board still shows it as pending. One of the two needs a tap.",
    },
    manager: (day) => `${day.name} said they started work the board still shows as pending.`,
  },
  "waiting-on-manager": {
    person: { title: "With the manager", message: "Your answer is with the manager. Anything else you can get on with?" },
    manager: (day) => `${day.name} is waiting on you: ${day.needsManager.map((row) => row.answer).join(", ")}.`,
  },
  unanswered: {
    person: { title: "A question is waiting", message: "There is a question about your day still open. A tap is enough." },
    // Carefully not "did nothing": an unanswered question is an unanswered
    // question, and the day board is built on the same refusal.
    manager: (day) => `${day.name} has ${day.unanswered} unanswered question${day.unanswered === 1 ? "" : "s"} today.`,
  },
};

/** A stored row as the rules module wants it, or null if it makes no sense. */
function toRule(row: {
  id: string;
  name: string;
  trigger: string;
  atLeast: number;
  action: string;
  recipient: string;
  graceMinutes: number;
  cooldownMinutes: number;
  escalateAfterMinutes: number | null;
  enabled: boolean;
}): Rule | null {
  if (!TRIGGERS.includes(row.trigger as Trigger)) return null;
  const action = row.action === "tell" || row.action === "escalate" ? row.action : "ask";
  const recipient: Recipient = row.recipient === "the-manager" ? "the-manager" : "the-person";

  return {
    id: row.id,
    name: row.name,
    trigger: row.trigger as Trigger,
    atLeast: row.atLeast,
    action,
    recipient,
    graceMinutes: row.graceMinutes,
    cooldownMinutes: row.cooldownMinutes,
    escalateAfterMinutes: row.escalateAfterMinutes,
    enabled: row.enabled,
  };
}

export type RuleRun = {
  /** How many rules were considered at all. */
  rules: number;
  /** Rule × person pairs looked at. */
  considered: number;
  sent: number;
  quiet: number;
  preview: boolean;
  /** One line per pair, in the words the preview screen shows. */
  lines: string[];
};

/**
 * Runs every rule against today, and says what it finds.
 *
 * In preview it writes nothing at all — no state, no notification — so a manager
 * can see exactly what a rule would have done before switching it on. That is
 * the only honest way to introduce something that talks to people by itself.
 */
export async function runRules(now: Date = new Date(), { preview = false } = {}): Promise<RuleRun> {
  const timezone = await getTimezone();
  const dayKey = todayKey(timezone);
  const switchedOn = preview ? true : await automationOn();

  const stored = await prisma.automationRule.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  const rules = stored.map(toRule).filter((rule): rule is Rule => rule !== null);
  if (rules.length === 0) {
    return { rules: 0, considered: 0, sent: 0, quiet: 0, preview, lines: [] };
  }

  const days = await dayBoard(dayKey);
  const day = dayKeyToDate(dayKey);

  let considered = 0;
  let sent = 0;
  let quiet = 0;
  const lines: string[] = [];

  for (const rule of rules) {
    for (const person of days) {
      considered += 1;

      const existing = await prisma.automationState.findUnique({
        where: { ruleId_employeeId_day: { ruleId: rule.id, employeeId: person.employeeId, day } },
        select: { since: true, lastActedAt: true },
      });

      const isTrue = countFor(rule.trigger, person) > 0;

      // The moment a condition became true is written down the first time it is
      // seen, and cleared the moment it stops — otherwise "true for two hours"
      // would quietly mean "true at some point in the last two hours".
      let since = existing?.since ?? null;
      if (isTrue && !since) since = now;
      if (!isTrue) since = null;

      if (!preview && (existing?.since ?? null)?.getTime() !== since?.getTime()) {
        await prisma.automationState.upsert({
          where: { ruleId_employeeId_day: { ruleId: rule.id, employeeId: person.employeeId, day } },
          create: { ruleId: rule.id, employeeId: person.employeeId, day, since },
          update: { since },
        });
      }

      const firing = evaluate(rule, person, { since, lastActedAt: existing?.lastActedAt ?? null }, now, switchedOn);
      lines.push(`${person.name} — ${describeFiring(rule, firing)}`);

      if (!firing.fires) {
        quiet += 1;
        continue;
      }
      if (preview) {
        sent += 1;
        continue;
      }

      const copy = COPY[rule.trigger];
      const dedupeKey = ruleKey(rule, person.employeeId, dayKey, firing.escalated);

      const result =
        firing.recipient === "the-manager"
          ? await notifyAdmin({
              type: "TASK_STATUS_CHANGED",
              title: rule.name,
              message: copy.manager(person),
              url: DASHBOARD_PATH,
              dedupeKey,
              employeeId: person.employeeId,
            }).catch(() => null)
          : await dispatchNotification({
              employeeId: person.employeeId,
              type: "SYSTEM_NOTIFICATION",
              title: copy.person.title,
              message: copy.person.message,
              url: DASHBOARD_PATH,
              dedupeKey,
              metadata: { ruleId: rule.id, trigger: rule.trigger, escalated: firing.escalated },
            }).catch(() => null);

      // Stamped whether or not it was delivered: a rule that could not reach
      // somebody is not one to retry on every run for the rest of the day.
      await prisma.automationState.upsert({
        where: { ruleId_employeeId_day: { ruleId: rule.id, employeeId: person.employeeId, day } },
        create: { ruleId: rule.id, employeeId: person.employeeId, day, since, lastActedAt: now },
        update: { lastActedAt: now },
      });

      if (result?.created) sent += 1;
      else quiet += 1;
    }
  }

  return { rules: rules.length, considered, sent, quiet, preview, lines };
}
