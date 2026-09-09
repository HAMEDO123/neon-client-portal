import { prisma } from "@/lib/db";
import { computePayroll, periodRange, type PayrollBreakdown } from "@/lib/payroll";

// Assembling a month's payroll: for each employee, the hours they arrived
// late, the receipts they are owed, and the resulting pay. The arithmetic
// itself lives in payroll.ts and is tested there.

export type PayrollRow = {
  employee: {
    id: string;
    name: string;
    role: string | null;
    salaryAmount: number | null;
    payBasis: "MONTHLY" | "WEEKLY";
  };
  delayDays: number;
  breakdown: PayrollBreakdown;
  receiptCount: number;
};

export async function getPayrollForPeriod(period: string): Promise<PayrollRow[]> {
  const { start, end } = periodRange(period);

  const employees = await prisma.employee.findMany({
    where: { accessRole: "EMPLOYEE" },
    orderBy: [{ active: "desc" }, { order: "asc" }],
    select: { id: true, name: true, role: true, salaryAmount: true, payBasis: true },
  });

  // Two grouped queries rather than one per employee, run one after the other:
  // concurrent aggregates on a single pooled connection have proven fragile
  // against the local Postgres proxy, and these are cheap either way.
  const attendance = await prisma.attendanceRecord.groupBy({
    by: ["employeeId"],
    where: { day: { gte: start, lt: end } },
    _sum: { delayHours: true },
    _count: { _all: true },
  });

  const receipts = await prisma.expenseReceipt.groupBy({
    by: ["employeeId"],
    where: { periodMonth: period },
    _sum: { countedAmount: true },
    _count: { _all: true },
  });

  const delayBy = new Map(attendance.map((row) => [row.employeeId, row]));
  const receiptBy = new Map(receipts.map((row) => [row.employeeId, row]));

  return employees.map((employee) => {
    const delay = delayBy.get(employee.id);
    const receipt = receiptBy.get(employee.id);

    return {
      employee,
      delayDays: delay?._count._all ?? 0,
      receiptCount: receipt?._count._all ?? 0,
      breakdown: computePayroll({
        salaryAmount: employee.salaryAmount,
        payBasis: employee.payBasis,
        delayHours: delay?._sum.delayHours ?? 0,
        receiptTotal: receipt?._sum.countedAmount ?? 0,
      }),
    };
  });
}

export function getAttendanceForPeriod(period: string) {
  const { start, end } = periodRange(period);
  return prisma.attendanceRecord.findMany({
    where: { day: { gte: start, lt: end } },
    orderBy: [{ day: "desc" }],
    include: { employee: { select: { id: true, name: true } } },
    take: 200,
  });
}

export function getReceiptsForPeriod(period: string) {
  return prisma.expenseReceipt.findMany({
    where: { periodMonth: period },
    orderBy: { createdAt: "desc" },
    include: { employee: { select: { id: true, name: true } } },
    take: 300,
  });
}

/** One employee's own receipts for a month, for the employee portal. */
export function getMyReceipts(employeeId: string, period: string) {
  return prisma.expenseReceipt.findMany({
    where: { employeeId, periodMonth: period },
    orderBy: { createdAt: "desc" },
  });
}
