import { prisma } from "@/lib/db";
import { resolveTimezone } from "@/lib/time";
import { parseWorkHours, type WorkHours } from "@/lib/work-hours";

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

// The working day itself: when it runs, when lunch is, and how much of it is
// deliberately left unplanned. Stored as separate keys so one of them can be
// changed without rewriting the rest, and read in a single query.
export const WORK_HOURS_KEYS = {
  days: "work_days",
  start: "work_start",
  end: "work_end",
  lunchMinutes: "work_lunch_minutes",
  lunchAt: "work_lunch_at",
  bufferMinutes: "work_buffer_minutes",
  graceMinutes: "work_grace_minutes",
} as const;

/**
 * The working day as the whole platform sees it.
 *
 * One query rather than six: this is read on every page that plans, follows up
 * or shows a time, and against a hosted database six round trips is six times
 * the latency for one answer. Anything missing or unusable falls back to the
 * default, so the studio always has a working day even with nothing saved.
 */
export async function getWorkHours(): Promise<WorkHours> {
  const keys = Object.values(WORK_HOURS_KEYS);
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [...keys] } } }).catch(() => []);
  const saved = new Map(rows.map((row) => [row.key, row.value]));

  return parseWorkHours({
    days: saved.get(WORK_HOURS_KEYS.days) ?? null,
    start: saved.get(WORK_HOURS_KEYS.start) ?? null,
    end: saved.get(WORK_HOURS_KEYS.end) ?? null,
    lunchMinutes: saved.get(WORK_HOURS_KEYS.lunchMinutes) ?? null,
    lunchAt: saved.get(WORK_HOURS_KEYS.lunchAt) ?? null,
    bufferMinutes: saved.get(WORK_HOURS_KEYS.bufferMinutes) ?? null,
    graceMinutes: saved.get(WORK_HOURS_KEYS.graceMinutes) ?? null,
  });
}
