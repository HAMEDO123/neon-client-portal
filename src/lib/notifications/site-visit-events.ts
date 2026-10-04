import { prisma } from "@/lib/db";
import { dispatchNotification } from "@/lib/notifications/engine";
import { getTimezone } from "@/lib/settings";
import { REMIND_BEFORE_MS, reminderDue, visitReminderCopy, visitReminderKey } from "@/lib/site-visits";
import { syncVisitTask } from "@/lib/site-visit-task-store";
import { instantAt, todayKey } from "@/lib/time";

// The reminder the day before a site visit, and the keeping of its job.
//
// The studio asked for it in one sentence: remind whoever is going, a day
// before. So twenty-four hours ahead of a planned visit — or on the next pass,
// for one written down later than that — they are told once, by a notification
// of its own type (SITE_VISIT), which is what gives it its own sound.
//
// There is no queue table, for the reason the meeting reminders have none: the
// notification's unique dedupe key carries the visit's own time, so a pass
// that runs twice or wakes late tells nobody twice, and a visit that moves
// earns a new reminder for its new time.
//
// Only a planned visit is reminded. One already written up, missed or called
// off has nothing ahead of it — and nothing here says a visit happened or did
// not: PLANNED is the only thing this reads.
//
// It also picks up any visit whose job is missing (lib/site-visit-task-store.ts)
// — the visits that existed before jobs did, and any whose sync failed at the
// moment it was written. From today on only: putting a job on a day weeks ago
// would say, on the week board, something nobody did.

export type SiteVisitPass = { due: number; reminded: number; tasks: number };

export async function runSiteVisitReminders(now: Date = new Date(), timeZone?: string): Promise<SiteVisitPass> {
  const zone = timeZone ?? (await getTimezone());

  // --- jobs for the visits that have none ------------------------------------
  const startOfToday = instantAt(todayKey(zone), "00:00", zone) ?? now;
  const jobless = await prisma.siteVisit.findMany({
    where: {
      task: { is: null },
      state: { in: ["PLANNED", "REPORTED"] },
      scheduledAt: { gte: startOfToday },
    },
    select: { id: true },
    take: 100,
  });

  let tasks = 0;
  // One at a time: each is several queries, and a burst is what the local
  // database falls over on.
  for (const visit of jobless) {
    const result = await syncVisitTask(visit.id, zone).catch(() => "none" as const);
    if (result === "created") tasks++;
  }

  // --- the reminder ------------------------------------------------------------
  const visits = await prisma.siteVisit.findMany({
    where: {
      state: "PLANNED",
      scheduledAt: { gt: now, lte: new Date(now.getTime() + REMIND_BEFORE_MS) },
    },
    select: { id: true, employeeId: true, title: true, location: true, scheduledAt: true, state: true },
    orderBy: { scheduledAt: "asc" },
    take: 100,
  });

  let reminded = 0;
  for (const visit of visits) {
    if (!visit.scheduledAt || !reminderDue(visit, now.getTime())) continue;

    const copy = visitReminderCopy({ ...visit, scheduledAt: visit.scheduledAt }, zone, now);
    const result = await dispatchNotification({
      employeeId: visit.employeeId,
      type: "SITE_VISIT",
      title: copy.title,
      message: copy.message,
      url: "/employee/tasks?view=visits",
      dedupeKey: visitReminderKey(visit.id, visit.scheduledAt),
    }).catch(() => null);

    if (result?.created) reminded++;
  }

  return { due: visits.length, reminded, tasks };
}
