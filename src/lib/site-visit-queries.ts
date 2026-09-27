import { prisma } from "@/lib/db";
import { sortForManager } from "@/lib/site-visits";
import type { SiteVisitState } from "@/generated/prisma/enums";

// Reading the site-visit diary.
//
// Separate from lib/site-visits.ts for the usual reason here: the judgement of
// what is overdue is pure and tested, and this only fetches rows and hands
// them to it.

const visitSelect = {
  id: true,
  employeeId: true,
  title: true,
  location: true,
  purpose: true,
  scheduledAt: true,
  state: true,
  report: true,
  reportedAt: true,
  employee: { select: { id: true, name: true, color: true } },
  project: { select: { id: true, name: true, clientName: true } },
} as const;

export type SiteVisitView = {
  id: string;
  employeeId: string;
  title: string;
  location: string | null;
  purpose: string | null;
  scheduledAt: Date;
  state: SiteVisitState;
  report: string | null;
  reportedAt: Date | null;
  employee: { id: string; name: string; color: string };
  project: { id: string; name: string; clientName: string | null } | null;
};

/**
 * One person's diary, theirs alone.
 *
 * Scoped by the id the session gave us, never by an argument from the browser
 * — the same rule the rest of the employee portal is built on.
 */
export async function siteVisitsFor(employeeId: string): Promise<SiteVisitView[]> {
  const rows = await prisma.siteVisit.findMany({
    where: { employeeId },
    orderBy: { scheduledAt: "desc" },
    select: visitSelect,
    take: 200,
  });

  return sortForManager(rows as SiteVisitView[]);
}

/** Every visit, for the manager, ordered by what needs them. */
export async function allSiteVisits(): Promise<SiteVisitView[]> {
  const rows = await prisma.siteVisit.findMany({
    orderBy: { scheduledAt: "desc" },
    select: visitSelect,
    take: 300,
  });

  return sortForManager(rows as SiteVisitView[]);
}

/** One visit, or null. Used to check ownership before answering for it. */
export async function siteVisitById(id: string): Promise<SiteVisitView | null> {
  const row = await prisma.siteVisit.findUnique({ where: { id }, select: visitSelect });
  return (row as SiteVisitView | null) ?? null;
}

/** The projects a visit can be attached to, newest first. */
export async function projectsForVisits() {
  return prisma.project.findMany({
    where: { publishState: { not: "ARCHIVED" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, clientName: true },
    take: 200,
  });
}
