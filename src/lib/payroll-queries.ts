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
  /** Why money was taken off beyond lateness, in the employee's own words on the payslip. */
  adjustments: { amount: number; reason: string }[];
};

export async function getPayrollForPeriod(period: string): Promise<PayrollRow[]> {
  const { start, end } = periodRange(period);

  const employees = await prisma.employee.findMany({
    where: { accessRole: "EMPLOYEE" },
    orderBy: [{ active: "desc" }, { order: "asc" }],
    select: { id: true, name: true, role: true, salaryAmount: true, payBasis: true },
  });

  // Two grouped queries rather than one per employee, and deliberately one
  // after the other. Running them together is a round trip faster and kills
  // the connection on the local Postgres proxy — a 500 on the machine this is
  // developed on costs more than the millisecond it saves.
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

  const adjustments = await prisma.salaryAdjustment.findMany({
    where: { periodKey: period },
    select: { employeeId: true, amount: true, reason: true },
  });

  const adjustmentBy = new Map<string, { amount: number; reason: string }[]>();
  for (const row of adjustments) {
    const list = adjustmentBy.get(row.employeeId) ?? [];
    list.push({ amount: row.amount, reason: row.reason });
    adjustmentBy.set(row.employeeId, list);
  }

  const delayBy = new Map(attendance.map((row) => [row.employeeId, row]));
  const receiptBy = new Map(receipts.map((row) => [row.employeeId, row]));

  return employees.map((employee) => {
    const delay = delayBy.get(employee.id);
    const receipt = receiptBy.get(employee.id);
    const adjusted = adjustmentBy.get(employee.id) ?? [];

    return {
      employee,
      delayDays: delay?._count._all ?? 0,
      receiptCount: receipt?._count._all ?? 0,
      adjustments: adjusted,
      breakdown: computePayroll({
        salaryAmount: employee.salaryAmount,
        payBasis: employee.payBasis,
        delayHours: delay?._sum.delayHours ?? 0,
        receiptTotal: receipt?._sum.countedAmount ?? 0,
        adjustmentTotal: adjusted.reduce((total, row) => total + row.amount, 0),
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
