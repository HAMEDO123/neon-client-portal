import { prisma } from "@/lib/db";
import { periodRange } from "@/lib/payroll";
import { DEFAULT_SALES_TARGET } from "@/lib/sales";

// Sales read from the projects themselves: one with a seller and a day counts
// in the month that day falls in — the same month window payroll uses, so the
// two never disagree about where a month ends.

export type SoldProject = { id: string; name: string; clientName: string; soldOn: Date | null };

export function salesForMonth(employeeId: string, period: string): Promise<SoldProject[]> {
  const { start, end } = periodRange(period);
  return prisma.project.findMany({
    where: { soldById: employeeId, soldOn: { gte: start, lt: end } },
    orderBy: { soldOn: "desc" },
    select: { id: true, name: true, clientName: true, soldOn: true },
  });
}

export async function salesTargetFor(employeeId: string) {
  const row = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { monthlySalesTarget: true },
  });
  return row?.monthlySalesTarget ?? DEFAULT_SALES_TARGET;
}

/** One person's month: what they sold, and what they were asked for. */
export async function monthSalesFor(employeeId: string, period: string) {
  // One after the other, like the other multi-query reads here.
  const projects = await salesForMonth(employeeId, period);
  const target = await salesTargetFor(employeeId);
  return { projects, target };
}

/** How many each person sold in the month, by employee id. */
export async function salesCountsForMonth(period: string): Promise<Map<string, number>> {
  const { start, end } = periodRange(period);
  const rows = await prisma.project.groupBy({
    by: ["soldById"],
    where: { soldById: { not: null }, soldOn: { gte: start, lt: end } },
    _count: { _all: true },
  });

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.soldById) counts.set(row.soldById, row._count._all);
  }
  return counts;
}

/** Who can be picked as the seller of a project. */
export function sellers() {
  return prisma.employee.findMany({
    where: { active: true, accessRole: "EMPLOYEE" },
    orderBy: { order: "asc" },
    select: { id: true, name: true },
  });
}
