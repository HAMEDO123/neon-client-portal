import { prisma } from "@/lib/db";
import { MANAGER_ACCESS_ROLE } from "@/lib/manager-account";
import { existedAt, monthSeries, openAt, shiftPeriod } from "@/lib/mobile/home-pulse-rules";
import { getTimezone } from "@/lib/settings";
import { dateToDayKey, dayKeyIn, instantAt, todayKey } from "@/lib/time";

// The Home tab's figures over time, for the phone only: the trend line and
// mini bars under two of the dashboard's four counts, the "This month" card,
// the manager's own name for the greeting, and who is waiting on a review.
//
// Only what the database actually records is counted:
//
// - Total projects: every project's `createdAt`. A project deleted since is in
//   neither the total nor its history, so the two always agree.
// - Pending approvals: an approval is open from `createdAt` until the client's
//   `respondedAt` (respondToApproval is the only thing that answers one, and it
//   always stamps the time). One answered with no time on record is counted as
//   never having been open, rather than open for ever.
// - Published and Updated this week have no history at all — nothing records
//   when a project was published, and `updatedAt` keeps only the latest edit —
//   so they get no trend here, and the app draws none rather than a guess.
//
// Reads one after another, like the rest of the dashboard: the local database
// drops its connection on a burst (README, "Gotchas").

const DAY_MS = 24 * 60 * 60 * 1000;

export async function homePulse() {
  const timezone = await getTimezone();
  const now = new Date();
  const today = todayKey(timezone);
  const period = today.slice(0, 7);
  const previousStart = instantAt(`${shiftPeriod(period, -1)}-01`, "00:00", timezone) ?? now;

  // The row the attendance device pairs the manager to (lib/manager-account.ts)
  // is the only place the platform keeps the manager's name. No row, no name:
  // the greeting then says good morning to nobody in particular.
  const manager = await prisma.employee.findFirst({
    where: { accessRole: MANAGER_ACCESS_ROLE, active: true },
    orderBy: { createdAt: "asc" },
    select: { name: true },
  });

  // Total projects: how many existed at the end of each of the last six
  // months (this month: so far), and how many were created this month.
  const projects = await prisma.project.findMany({ select: { createdAt: true, soldOn: true } });
  const monthEnds = [
    ...[-4, -3, -2, -1, 0].map((offset) => instantAt(`${shiftPeriod(period, offset)}-01`, "00:00", timezone) ?? now),
    now,
  ];
  const createdKeys = projects.map((project) => dayKeyIn(timezone, project.createdAt));

  // Pending approvals at the end of each of the last six weeks (the last one
  // is now), so the change is "since a week ago".
  const approvals = await prisma.approval.findMany({
    select: { status: true, createdAt: true, respondedAt: true },
  });
  const weekEnds = [5, 4, 3, 2, 1, 0].map((weeks) => new Date(now.getTime() - weeks * 7 * DAY_MS));
  const pending = openAt(
    approvals.map((approval) => ({
      from: approval.createdAt,
      to: approval.status === "PENDING" ? null : (approval.respondedAt ?? approval.createdAt),
    })),
    weekEnds
  );

  // Work marked done — board steps and jobs handed out by hand. Only the
  // manager can put either into DONE (lib/task-transitions.ts), so this is
  // work approved as finished, each piece counted once, on the day it was
  // last marked done (`completedAt` is cleared if it is reopened).
  const doneCells = await prisma.projectTaskEntry.findMany({
    where: { state: "DONE", completedAt: { gte: previousStart } },
    select: { completedAt: true },
  });
  const doneJobs = await prisma.assignedTask.findMany({
    where: { state: "DONE", completedAt: { gte: previousStart } },
    select: { completedAt: true },
  });
  const doneKeys = [...doneCells, ...doneJobs]
    .map((row) => (row.completedAt ? dayKeyIn(timezone, row.completedAt) : null))
    .filter((key): key is string => key !== null);

  // `soldOn` is a calendar day already (@db.Date), the month a sale counts in.
  const soldKeys = projects
    .map((project) => dateToDayKey(project.soldOn))
    .filter((key): key is string => key !== null);

  // Who is waiting on a review: the evidence queue (lib/submissions.ts reads
  // the same rows, status PENDING), each person once, oldest first.
  const waiting = await prisma.taskSubmission.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: { employee: { select: { id: true, name: true, color: true, photoUrl: true } } },
  });
  const people = new Map<string, { id: string; name: string; color: string; photoUrl: string | null }>();
  for (const row of waiting) if (!people.has(row.employee.id)) people.set(row.employee.id, row.employee);

  return {
    timezone,
    today,
    manager: manager ? { name: manager.name } : null,
    projects: {
      createdThisMonth: createdKeys.filter((key) => key.startsWith(period)).length,
      monthEnds: existedAt(
        projects.map((project) => project.createdAt),
        monthEnds
      ),
    },
    approvals: {
      weekEnds: pending,
      change: pending[pending.length - 1] - pending[pending.length - 2],
    },
    month: {
      completed: monthSeries(doneKeys, today),
      sold: monthSeries(soldKeys, today),
      created: monthSeries(createdKeys, today),
    },
    reviews: {
      waiting: waiting.length,
      people: [...people.values()],
    },
  };
}
