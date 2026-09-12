import { prisma } from "@/lib/db";
import { resolveTimezone } from "@/lib/time";

// Platform settings live in a small key/value table so the timezone can be
// changed without a redeploy. The environment variable is the fallback, and a
// sane default is the fallback for that.

export const TIMEZONE_SETTING_KEY = "timezone";

// How the studio plans a day, written by the manager: nobody takes more than
// three jobs, site visits in the morning, renders two days before a handover.
// Read whenever a day is proposed for somebody, beside what each person
// usually does.
export const PLANNING_NOTES_KEY = "planning_notes";

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } }).catch(() => null);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function getTimezone() {
  return resolveTimezone(await getSetting(TIMEZONE_SETTING_KEY));
}

/** The studio's rules for planning a day. Empty until somebody writes them. */
export async function getPlanningNotes() {
  return (await getSetting(PLANNING_NOTES_KEY)) ?? "";
}
