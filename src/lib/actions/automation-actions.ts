"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { ACTIONS, RECIPIENTS, TRIGGERS, type Action, type Recipient, type Trigger } from "@/lib/automation";
import { AUTOMATION_SWITCH_KEY } from "@/lib/notifications/automation-events";
import { setSetting } from "@/lib/settings";

// The studio's own rules, as the manager edits them.
//
// Admin only, checked here: these are public POST endpoints and the layout's
// redirect is a convenience for the browser, not a security boundary.
//
// Nothing in this file can act on work. The worst a saved rule does is speak,
// and it does not even do that until both it and the studio-wide switch are on.

async function requireAdmin() {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) {
    throw new Error("Unauthorized");
  }
}

function refresh() {
  revalidatePath("/admin/settings");
}

/** A whole number of minutes, or null where the box was left empty. */
function minutes(value: FormDataEntryValue | null, field: string): number | null {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;

  const parsed = Math.round(Number(raw));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${field} must be a whole number of minutes, zero or more.`);
  }
  return parsed;
}

function readRule(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim().slice(0, 200);
  if (!name) throw new Error("Give the rule a name, so it is obvious later what it was for.");

  const trigger = String(formData.get("trigger") ?? "");
  if (!TRIGGERS.includes(trigger as Trigger)) throw new Error("That is not a condition this can watch for.");

  const action = String(formData.get("action") ?? "");
  if (!ACTIONS.includes(action as Action)) throw new Error("That is not something a rule may do.");

  const recipient = String(formData.get("recipient") ?? "");
  if (!RECIPIENTS.includes(recipient as Recipient)) throw new Error("That is not somebody a rule may speak to.");

  const atLeast = Math.round(Number(String(formData.get("atLeast") ?? "1")));
  if (!Number.isFinite(atLeast) || atLeast < 1) throw new Error("A rule waits for at least one of the thing.");

  return {
    name,
    trigger,
    action,
    recipient,
    atLeast,
    graceMinutes: minutes(formData.get("graceMinutes"), "The grace") ?? 0,
    cooldownMinutes: minutes(formData.get("cooldownMinutes"), "The cooldown") ?? 0,
    // Empty means never escalate, which is different from escalating at once.
    escalateAfterMinutes: minutes(formData.get("escalateAfterMinutes"), "The escalation"),
    enabled: formData.get("enabled") === "on",
  };
}

export async function createAutomationRule(formData: FormData) {
  await requireAdmin();
  const fields = readRule(formData);

  const count = await prisma.automationRule.count();
  await prisma.automationRule.create({ data: { ...fields, order: count } });

  refresh();
}

export async function updateAutomationRule(id: string, formData: FormData) {
  await requireAdmin();
  const fields = readRule(formData);

  await prisma.automationRule.update({ where: { id }, data: fields });
  refresh();
}

export async function deleteAutomationRule(id: string) {
  await requireAdmin();
  // Its remembered state goes with it, so re-creating the same rule later
  // starts from silence rather than from an old cooldown.
  await prisma.automationRule.delete({ where: { id } }).catch(() => {});
  refresh();
}

/**
 * The one switch that stops all of it.
 *
 * Separate from the rules themselves on purpose: turning rules off one by one
 * while something is going wrong is not a kill switch, and a kill switch that
 * needs six clicks is not one either.
 */
export async function setAutomationSwitch(on: boolean) {
  await requireAdmin();
  await setSetting(AUTOMATION_SWITCH_KEY, on ? "on" : "off");

  refresh();
}
