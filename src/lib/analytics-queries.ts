import { prisma } from "@/lib/db";
import { periodRange } from "@/lib/payroll";
import { planForProjects } from "@/lib/stage-deadlines";
import { dateToDayKey, dayKeyToDate } from "@/lib/time";
import { daysEnding, groupDaily, type PersonDay } from "@/lib/daily-progress";
import { holderKey } from "@/lib/ownership";
import {
  isShortfall,
  progressOf,
  timelinessOf,
  type ProgressCounts,
} from "@/lib/analytics";

// Counting a period's work per employee, in one query.
//
// A task belongs to whoever the board says it does (ownerOf in ownership.ts):
// a person named on the cell, then whoever holds the step's section on that
// project, then the step's standing owner — expressed here as a COALESCE over
// those three, so the grouping matches exactly what each person sees in their
// own list.
//
// A task counts towards a period if it was scheduled in it, due in it, or —
// having neither date — created in it. That covers how the board is actually
// used: some cells are scheduled, some are only ticked. Cells the manager
// marked "not counted" are left out entirely, on either side of the fraction.

type CountRow = {
  employeeId: string;
  total: bigint;
  completed: bigint;
  awaiting_review: bigint;
  in_progress: bigint;
  pending: bigint;
  overdue: bigint;
  on_time: bigint;
};

export type EmployeeProgress = {
  employee: {
    id: string;
    name: string;
    role: string | null;
    color: string;
    active: boolean;
    salaryAmount: number | null;
  };
  counts: ProgressCounts;
  progress: number;
  timeliness: number;
  shortfall: boolean;
  /** A deduction already recorded for this period, if the rule has been applied. */
  deduction: { amount: number; reason: string } | null;
};

export async function getEmployeeProgress(
  period: string,
  now = new Date()
): Promise<EmployeeProgress[]> {
  const { start, end } = periodRange(period);

  const employees = await prisma.employee.findMany({
    where: { accessRole: "EMPLOYEE" },
    orderBy: [{ active: "desc" }, { order: "asc" }],
    select: { id: true, name: true, role: true, color: true, active: true, salaryAmount: true },
  });

  // Sequential, like payroll: running these together is what kills the local
  // Postgres proxy.
  const rows = await prisma.$queryRaw<CountRow[]>`
    SELECT
      COALESCE(e."assigneeId", psa."employeeId", pt."employeeId") AS "employeeId",
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE e."state" = 'DONE') AS completed,
      COUNT(*) FILTER (WHERE e."state" = 'SUBMITTED') AS awaiting_review,
      COUNT(*) FILTER (WHERE e."state" = 'IN_PROGRESS') AS in_progress,
      COUNT(*) FILTER (WHERE e."state" IN ('TODO', 'TOMORROW')) AS pending,
      COUNT(*) FILTER (
        WHERE e."dueAt" IS NOT NULL AND e."dueAt" < NOW() AND e."state" <> 'DONE'
      ) AS overdue,
      COUNT(*) FILTER (
        WHERE e."state" = 'DONE'
          AND (e."dueAt" IS NULL OR e."completedAt" IS NULL OR e."completedAt" <= e."dueAt")
      ) AS on_time
    FROM "ProjectTaskEntry" e
    JOIN "ProcessTask" pt ON pt."id" = e."taskId"
    LEFT JOIN "ProjectSectionAssignment" psa
      ON psa."projectId" = e."projectId" AND psa."sectionId" = pt."sectionId"
    WHERE COALESCE(e."assigneeId", psa."employeeId", pt."employeeId") IS NOT NULL
      AND e."excludedFromProgress" = false
      AND (
        (e."scheduledFor" >= ${start} AND e."scheduledFor" < ${end})
        OR (e."dueAt" >= ${start} AND e."dueAt" < ${end})
        OR (
          e."scheduledFor" IS NULL AND e."dueAt" IS NULL
          AND e."createdAt" >= ${start} AND e."createdAt" < ${end}
        )
      )
    GROUP BY 1
  `;

  const adjustments = await prisma.salaryAdjustment.findMany({
    where: { periodKey: period, kind: "PERFORMANCE" },
    select: { employeeId: true, amount: true, reason: true },
  });

  // Being late is a present-tense fact, and most deadlines are worked out from
  // the stage periods rather than typed onto a cell — so the SQL above, which
  // only sees a stored dueAt, undercounts. Overlay the real answer while the
  // period being looked at is the one running; a past month keeps whatever it
  // counted at the time.
  const overdueBy = new Map<string, number>();
  if (now >= start && now < end) {
    const projects = await prisma.project.findMany({
      where: { publishState: { not: "ARCHIVED" } },
      select: { id: true },
    });
    const plan = await planForProjects(projects.map((project) => project.id));

    for (const stage of plan.values()) {
      if (!stage.ownerId || !stage.dueBy) continue;
      if (stage.excludedFromProgress) continue;
      if (stage.state === "DONE" || stage.state === "SUBMITTED") continue;
      if (stage.dueBy >= now) continue;
      overdueBy.set(stage.ownerId, (overdueBy.get(stage.ownerId) ?? 0) + 1);
    }
  }

  const countsBy = new Map(rows.map((row) => [row.employeeId, row]));
  const deductionBy = new Map(adjustments.map((row) => [row.employeeId, row]));

  return employees.map((employee) => {
    const row = countsBy.get(employee.id);
    const counts: ProgressCounts = {
      total: Number(row?.total ?? 0),
      completed: Number(row?.completed ?? 0),
      awaitingReview: Number(row?.awaiting_review ?? 0),
      inProgress: Number(row?.in_progress ?? 0),
      pending: Number(row?.pending ?? 0),
      overdue: overdueBy.get(employee.id) ?? Number(row?.overdue ?? 0),
      onTime: Number(row?.on_time ?? 0),
    };
    const deduction = deductionBy.get(employee.id);

    return {
      employee,
      counts,
      progress: progressOf(counts),
      timeliness: timelinessOf(counts),
      shortfall: isShortfall(counts),
      deduction: deduction ? { amount: deduction.amount, reason: deduction.reason } : null,
    };
  });
}

export type DailyProgress = PersonDay & {
  employee: { id: string; name: string; role: string | null; color: string; active: boolean };
};

/**
 * Everyone's day: the chosen one, and the `days` running up to it for the
 * strip. What counts is decided in daily-progress.ts, the same code the
 * employee's own "Today's progress" uses.
 */
export async function getDailyProgress(dayKey: string, days = 7): Promise<DailyProgress[]> {
  const keys = daysEnding(dayKey, days);
  const first = dayKeyToDate(keys[0]);
  const last = dayKeyToDate(keys[keys.length - 1]);

  // One after the other, for the same reason as above.
  const employees = await prisma.employee.findMany({
    where: { accessRole: "EMPLOYEE" },
    orderBy: [{ active: "desc" }, { order: "asc" }],
    select: { id: true, name: true, role: true, color: true, active: true },
  });

  const holders = await prisma.projectSectionAssignment.findMany({
    where: { employeeId: { not: null } },
    select: { projectId: true, sectionId: true, employeeId: true },
  });

  // Steps scheduled inside the strip, and anything being worked on now,
  // whatever day it is on.
  const entries = await prisma.projectTaskEntry.findMany({
    where: { OR: [{ scheduledFor: { gte: first, lte: last } }, { state: "IN_PROGRESS" }] },
    select: {
      id: true,
      state: true,
      scheduledFor: true,
      excludedFromProgress: true,
      assigneeId: true,
      projectId: true,
      project: { select: { name: true } },
      task: { select: { name: true, employeeId: true, sectionId: true } },
    },
  });

  // Jobs that can be on a list inside the strip — including late ones still
  // open — and any being worked on now.
  const jobs = await prisma.assignedTask.findMany({
    where: {
      OR: [
        { state: "IN_PROGRESS" },
        { startDay: { lte: last }, OR: [{ endDay: { gte: first } }, { NOT: { state: "DONE" } }] },
      ],
    },
    select: { id: true, employeeId: true, title: true, startDay: true, endDay: true, state: true },
  });

  const byPerson = groupDaily({
    employeeIds: employees.map((employee) => employee.id),
    steps: entries.map((entry) => ({
      id: entry.id,
      state: entry.state,
      dayKey: dateToDayKey(entry.scheduledFor),
      excludedFromProgress: entry.excludedFromProgress,
      assigneeId: entry.assigneeId,
      projectId: entry.projectId,
      projectName: entry.project.name,
      stepName: entry.task.name,
      stepOwnerId: entry.task.employeeId,
      sectionId: entry.task.sectionId,
    })),
    jobs: jobs.map((job) => ({
      id: job.id,
      employeeId: job.employeeId,
      title: job.title,
      startKey: dateToDayKey(job.startDay)!,
      endKey: dateToDayKey(job.endDay)!,
      state: job.state,
    })),
    sectionHolders: new Map(holders.map((row) => [holderKey(row.projectId, row.sectionId), row.employeeId!])),
    days: keys,
  });

  return employees.map((employee) => ({ employee, ...byPerson.get(employee.id)! }));
}
