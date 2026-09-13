"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-guard";
import { PLANNING_NOTES_KEY, WORK_HOURS_KEYS, setSetting } from "@/lib/settings";
import { parseWorkHours } from "@/lib/work-hours";

// The studio's own rules, kept beside the timezone in the settings table.
// Admin only: these are public POST endpoints, and the layout's redirect is a
// convenience for the browser rather than a security boundary.

/**
 * How a day is planned here, in the manager's words. Free text on purpose:
 * the rules that matter ("site visits in the morning", "Sally does two
 * renders a day") are not fields, and writing them as prose is what makes a
 * proposed day look like this studio's day.
 */
/**
 * The working day: the hours, the lunch, the margin kept back.
 *
 * Everything typed in is put through the same reader the platform uses, so what
 * is stored is always a day that makes sense — a finish before a start, or a
 * lunch longer than the day, falls back rather than being saved and quietly
 * breaking every plan and follow-up afterwards.
 *
 * Changing this changes the future only. Days already planned keep the times
 * they were planned with; nothing historic is rewritten.
 */
export async function saveWorkHours(formData: FormData) {
  await requireAdmin();

  const hours = parseWorkHours({
    days: formData.getAll("days").map(String).join(","),
    start: String(formData.get("start") ?? ""),
    end: String(formData.get("end") ?? ""),
    lunchMinutes: String(formData.get("lunchMinutes") ?? ""),
    lunchAt: String(formData.get("lunchAt") ?? ""),
    bufferMinutes: String(formData.get("bufferMinutes") ?? ""),
  });

  // One after another, like every other multi-write here.
  await setSetting(WORK_HOURS_KEYS.days, hours.days.join(","));
  await setSetting(WORK_HOURS_KEYS.start, hours.start);
  await setSetting(WORK_HOURS_KEYS.end, hours.end);
  await setSetting(WORK_HOURS_KEYS.lunchMinutes, String(hours.lunchMinutes));
  await setSetting(WORK_HOURS_KEYS.lunchAt, hours.lunchAt);
  await setSetting(WORK_HOURS_KEYS.bufferMinutes, String(hours.bufferMinutes));

  revalidatePath("/admin/settings");
  revalidatePath("/admin/tasks");
  revalidatePath("/admin/employees", "layout");
}

export async function savePlanningNotes(formData: FormData) {
  await requireAdmin();

  const notes = String(formData.get("planningNotes") ?? "").trim().slice(0, 6000);
  await setSetting(PLANNING_NOTES_KEY, notes);

  revalidatePath("/admin/settings");
  revalidatePath("/admin/tasks");
}
