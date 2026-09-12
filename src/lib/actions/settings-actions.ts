"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { PLANNING_NOTES_KEY, setSetting } from "@/lib/settings";

// The studio's own rules, kept beside the timezone in the settings table.
// Admin only: these are public POST endpoints, and the layout's redirect is a
// convenience for the browser rather than a security boundary.

async function requireAdmin() {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) {
    throw new Error("Unauthorized");
  }
}

/**
 * How a day is planned here, in the manager's words. Free text on purpose:
 * the rules that matter ("site visits in the morning", "Sally does two
 * renders a day") are not fields, and writing them as prose is what makes a
 * proposed day look like this studio's day.
 */
export async function savePlanningNotes(formData: FormData) {
  await requireAdmin();

  const notes = String(formData.get("planningNotes") ?? "").trim().slice(0, 6000);
  await setSetting(PLANNING_NOTES_KEY, notes);

  revalidatePath("/admin/settings");
  revalidatePath("/admin/tasks");
}
