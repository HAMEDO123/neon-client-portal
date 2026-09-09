import { prisma } from "@/lib/db";
import { periodRange } from "@/lib/payroll";
import {
  isShortfall,
  progressOf,
  timelinessOf,
  type ProgressCounts,
} from "@/lib/analytics";

// Counting a period's work per employee, in one query.
//
// A task belongs to whoever it is assigned to, and to the owner of its process
// step when it is not assigned to anyone — the same rule the employee portal
// enforces, expressed here as COALESCE so the grouping matches exactly what
// each person sees in their own list.
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

export async function getEmployeeProgress(period: string): Promise<EmployeeProgress[]> {
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
      COALESCE(e."assigneeId", pt."employeeId") AS "employeeId",
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
    WHERE COALESCE(e."assigneeId", pt."employeeId") IS NOT NULL
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
      overdue: Number(row?.overdue ?? 0),
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
