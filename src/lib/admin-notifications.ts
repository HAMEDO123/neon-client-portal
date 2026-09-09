import { prisma } from "@/lib/db";
import type { AdminNotificationType } from "@/generated/prisma/enums";

// The manager's feed: work coming back up from the team.
//
// The employee engine exists because a notification there has to consult
// preferences, fan out to devices and log every attempt. None of that applies
// here — there is one manager, reading one screen — so this stays a single
// idempotent insert. The dedupeKey carries the same guarantee: a retried
// request, or a job that runs twice, writes one row.

export type AdminAlert = {
  type: AdminNotificationType;
  title: string;
  message: string;
  url: string;
  dedupeKey: string;
  entryId?: string | null;
  employeeId?: string | null;
};

export async function notifyAdmin(alert: AdminAlert) {
  try {
    await prisma.adminNotification.create({
      data: {
        type: alert.type,
        title: alert.title,
        message: alert.message,
        url: alert.url,
        dedupeKey: alert.dedupeKey,
        entryId: alert.entryId ?? null,
        employeeId: alert.employeeId ?? null,
      },
    });
    return { created: true as const };
  } catch (error) {
    // A duplicate is the normal outcome of a retry, not a failure. Anything
    // else is swallowed too: the manager missing an alert must never be the
    // reason an employee's save fails.
    if (isUniqueViolation(error)) return { created: false as const, skipped: "duplicate" as const };
    return { created: false as const, skipped: "error" as const };
  }
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

export function recentAdminAlerts(limit = 50) {
  return prisma.adminNotification.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { employee: { select: { name: true, color: true } } },
  });
}

export function countUnreadAdminAlerts() {
  return prisma.adminNotification.count({ where: { readAt: null } });
}

export function markAdminAlertsRead() {
  return prisma.adminNotification.updateMany({
    where: { readAt: null },
    data: { readAt: new Date() },
  });
}
