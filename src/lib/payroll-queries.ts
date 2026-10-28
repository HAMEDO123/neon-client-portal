import { prisma } from "@/lib/db";
import { computePayroll, periodRange, type PayrollBreakdown } from "@/lib/payroll";
import { liveDeductions } from "@/lib/deduction-store";
import { workedHours, type WorkedTotal } from "@/lib/attendance";
import { getTimezone, getWorkHours } from "@/lib/settings";
import { buildAttendanceSheet, type AttendanceSheet } from "@/lib/attendance-sheet";
import { hourlyRate } from "@/lib/payroll";
import { dateToDayKey, todayKey } from "@/lib/time";

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
  /**
   * How long they were actually at work this period, the days capped at the
   * studio's own eight.
   *
   * Not what the pay is worked out from — a monthly salary is docked for the
   * hours a day fell short, not paid per hour — and on the screen beside it for
   * exactly that reason: "how much was taken off" and "how much did they work"
   * are different questions, and the second one had no answer anywhere.
   */
  worked: WorkedTotal;
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
    _sum: { delayHours: true, earlyHours: true, awayHours: true, shortHours: true },
    _count: { _all: true },
  });

  // The times themselves, for how long people were actually here. The grouped
  // sums above cannot answer that one: hours worked is a per-day figure, each
  // day capped at the studio's own, so the days are added up one at a time.
  const times = await prisma.attendanceRecord.findMany({
    where: { day: { gte: start, lt: end } },
    select: { employeeId: true, arrivedAt: true, departedAt: true, awayHours: true },
    orderBy: { day: "asc" },
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

  // Cutoffs — the manager's own, and a task not handed in by nine — are money
  // off like any other adjustment, one row each. Ones taken back are not read.
  const deductions = await liveDeductions(period);

  const adjustmentBy = new Map<string, { amount: number; reason: string }[]>();
  for (const row of [...adjustments, ...deductions]) {
    const list = adjustmentBy.get(row.employeeId) ?? [];
    list.push({ amount: row.amount, reason: row.reason });
    adjustmentBy.set(row.employeeId, list);
  }

  const delayBy = new Map(attendance.map((row) => [row.employeeId, row]));
  const receiptBy = new Map(receipts.map((row) => [row.employeeId, row]));

  const timesBy = new Map<string, typeof times>();
  for (const row of times) timesBy.set(row.employeeId, [...(timesBy.get(row.employeeId) ?? []), row]);

  // The studio's day, for the cap on each one of them.
  const hours = await getWorkHours();

  return employees.map((employee) => {
    const delay = delayBy.get(employee.id);
    const receipt = receiptBy.get(employee.id);
    const adjusted = adjustmentBy.get(employee.id) ?? [];

    return {
      employee,
      delayDays: delay?._count._all ?? 0,
      worked: workedHours(timesBy.get(employee.id) ?? [], hours),
      receiptCount: receipt?._count._all ?? 0,
      adjustments: adjusted,
      breakdown: computePayroll({
        salaryAmount: employee.salaryAmount,
        payBasis: employee.payBasis,
        delayHours: delay?._sum.delayHours ?? 0,
        // Leaving early costs the same hourly rate as arriving late. A day
        // nobody clocked out of carries zero here, not a guess.
        earlyHours: delay?._sum.earlyHours ?? 0,
        // Out in the middle of a day and back. A fact about the day now rather
        // than a charge of its own: it pushed the end of that person's day back.
        awayHours: delay?._sum.awayHours ?? 0,
        // The one that is actually multiplied by the rate.
        shortHours: delay?._sum.shortHours ?? 0,
        receiptTotal: receipt?._sum.countedAmount ?? 0,
        adjustmentTotal: adjusted.reduce((total, row) => total + row.amount, 0),
      }),
    };
  });
}

/**
 * A month's attendance written out person by person, day by day — the sheet
 * behind /admin/payroll/sheet and its download.
 *
 * Reads the same rows the pay sheet totals and hands them to the same pure
 * builder, so the day-by-day working can be checked against the month's figure
 * and cannot quietly disagree with it.
 */
export async function getAttendanceSheet(period: string): Promise<AttendanceSheet> {
  const { start, end } = periodRange(period);

  const employees = await prisma.employee.findMany({
    where: { accessRole: "EMPLOYEE" },
    orderBy: [{ active: "desc" }, { order: "asc" }],
    select: { id: true, name: true, role: true, salaryAmount: true, payBasis: true, openHours: true },
  });

  const records = await prisma.attendanceRecord.findMany({
    where: { day: { gte: start, lt: end } },
    orderBy: { day: "asc" },
    select: {
      employeeId: true,
      day: true,
      arrivedAt: true,
      departedAt: true,
      breaks: true,
      delayHours: true,
      earlyHours: true,
      awayHours: true,
      shortHours: true,
      source: true,
      note: true,
    },
  });

  const hours = await getWorkHours();
  const timeZone = await getTimezone();

  return buildAttendanceSheet({
    monthKey: period,
    hours,
    timeZone,
    todayKey: todayKey(timeZone),
    people: employees.map((employee) => ({
      id: employee.id,
      name: employee.name,
      role: employee.role,
      openHours: employee.openHours,
      // What an hour of this person's time costs, so a day's shortfall can be
      // priced on its own line rather than only in the month's total.
      hourlyRate: hourlyRate(employee.salaryAmount ?? 0, employee.payBasis),
    })),
    records: records.map((record) => ({
      ...record,
      // The sheet works in day keys; the column is a date at UTC midnight.
      dayKey: dateToDayKey(record.day) ?? "",
    })),
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

/**
 * Every receipt the studio has, newest first.
 *
 * The payroll screen shows them a month at a time, all months on the one page,
 * so this is not scoped to a period: `periodMonth` is already on the row — the
 * month a receipt was sent, whatever date is printed on it — and the page
 * groups by it.
 */
export function getAllReceipts() {
  return prisma.expenseReceipt.findMany({
    orderBy: [{ periodMonth: "desc" }, { createdAt: "desc" }],
    include: { employee: { select: { id: true, name: true } } },
    take: 1000,
  });
}

/** One employee's own receipts for a month, for the employee portal. */
export function getMyReceipts(employeeId: string, period: string) {
  return prisma.expenseReceipt.findMany({
    where: { employeeId, periodMonth: period },
    orderBy: { createdAt: "desc" },
  });
}
