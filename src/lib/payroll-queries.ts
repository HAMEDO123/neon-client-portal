import { prisma } from "@/lib/db";
import { computePayroll, periodRange, type PayrollBreakdown } from "@/lib/payroll";
import { liveDeductionsBetween } from "@/lib/deduction-store";
import { workedHours, type WorkedTotal } from "@/lib/attendance";
import { getTimezone, getWorkHours } from "@/lib/settings";
import { buildAttendanceSheet, type AttendanceSheet } from "@/lib/attendance-sheet";
import { monthBounds } from "@/lib/attendance-month";
import { hourlyRate } from "@/lib/payroll";
import { dateToDayKey, dayKeyIn, dayKeyToDate, todayKey } from "@/lib/time";
import { paySlices, type PayWeek } from "@/lib/pay-week";

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
  /**
   * The pay week this row is, for somebody settled weekly — null for a monthly
   * salary, whose row is the whole month.
   *
   * Somebody paid by the week has a row per week rather than one for the
   * month: their 75 JOD is a week's pay, and charging four weeks of lateness
   * and cutoffs against it was a deduction nobody owed.
   */
  week: PayWeek | null;
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
  const timezone = await getTimezone();
  const today = todayKey(timezone);

  const employees = await prisma.employee.findMany({
    where: { accessRole: "EMPLOYEE" },
    orderBy: [{ active: "desc" }, { order: "asc" }],
    select: { id: true, name: true, role: true, salaryAmount: true, payBasis: true },
  });

  // What each person's pay is settled in: the month, or a row per pay week for
  // somebody paid weekly (lib/pay-week.ts). A weekly salary charged a whole
  // month of deductions is the wrong sum, and it could only ever be too large.
  const sliced = employees.map((employee) => ({
    employee,
    slices: paySlices(employee.payBasis, period, today),
  }));

  // One span wide enough for every row, so the queries below do not multiply
  // with the weeks: a pay week can run past the end of the month it belongs to.
  // The month itself is always in the span, so a month with nobody on a weekly
  // salary queries exactly what it did before.
  const spans = [{ ...monthBounds(period) }, ...sliced.flatMap((row) => row.slices.map((slice) => ({ from: slice.fromKey, to: slice.toKey })))];
  const fromKey = spans.map((span) => span.from).sort()[0];
  const toKey = spans.map((span) => span.to).sort().reverse()[0];
  // The months that span touches, for what is still filed by month.
  const months = [...new Set([period, fromKey.slice(0, 7), toKey.slice(0, 7)])];

  // Sequential, deliberately. Running them together is a round trip faster and
  // kills the connection on the local Postgres proxy — a 500 on the machine
  // this is developed on costs more than the millisecond it saves.
  const records = await prisma.attendanceRecord.findMany({
    where: { day: { gte: dayKeyToDate(fromKey), lte: dayKeyToDate(toKey) } },
    orderBy: { day: "asc" },
    select: {
      employeeId: true,
      day: true,
      arrivedAt: true,
      departedAt: true,
      delayHours: true,
      earlyHours: true,
      awayHours: true,
      shortHours: true,
    },
  });

  const receipts = await prisma.expenseReceipt.findMany({
    where: { periodMonth: { in: months } },
    select: { employeeId: true, countedAmount: true, createdAt: true, periodMonth: true },
  });

  const adjustments = await prisma.salaryAdjustment.findMany({
    where: { periodKey: { in: months } },
    select: { employeeId: true, amount: true, reason: true, periodKey: true, createdAt: true },
  });

  // Cutoffs — the manager's own, and a task not handed in by midnight — are
  // money off like any other adjustment. Read by the day they are for rather
  // than by their month, which is the same set for a month and the only way to
  // put one in the right week. Ones taken back are not read.
  const deductions = await liveDeductionsBetween(dayKeyToDate(fromKey), dayKeyToDate(toKey));

  // The studio's day, for the cap on each day's hours.
  const hours = await getWorkHours();

  const rows: PayrollRow[] = [];

  for (const { employee, slices } of sliced) {
    for (const slice of slices) {
      const within = (dayKey: string | null) => dayKey != null && dayKey >= slice.fromKey && dayKey <= slice.toKey;
      const days = records.filter((record) => record.employeeId === employee.id && within(dateToDayKey(record.day)));

      // A receipt belongs to the week it was sent in, and a month's row reads
      // the month it was filed under: `periodMonth` is set when it arrives and
      // never moves, so for a month these two are the same answer.
      const theirs = receipts.filter((receipt) => receipt.employeeId === employee.id);
      const paid = slice.week
        ? theirs.filter((receipt) => within(dayKeyIn(timezone, receipt.createdAt)))
        : theirs.filter((receipt) => receipt.periodMonth === period);

      // An adjustment carries no day of its own — only the month it is for —
      // so a week takes the ones the manager entered during it. The reason
      // names the days it was for, which is what anybody checking it reads.
      const theirAdjustments = adjustments.filter((row) => row.employeeId === employee.id);
      const adjusted = [
        ...(slice.week
          ? theirAdjustments.filter((row) => within(dayKeyIn(timezone, row.createdAt)))
          : theirAdjustments.filter((row) => row.periodKey === period)),
        ...deductions.filter((row) => row.employeeId === employee.id && within(dateToDayKey(row.day))),
      ].map((row) => ({ amount: row.amount, reason: row.reason }));

      rows.push({
        employee,
        week: slice.week,
        delayDays: days.length,
        worked: workedHours(days, hours),
        receiptCount: paid.length,
        adjustments: adjusted,
        breakdown: computePayroll({
          salaryAmount: employee.salaryAmount,
          payBasis: employee.payBasis,
          delayHours: sum(days, (day) => day.delayHours),
          // Leaving early costs the same hourly rate as arriving late. A day
          // nobody clocked out of carries zero here, not a guess.
          earlyHours: sum(days, (day) => day.earlyHours),
          // Out in the middle of a day and back. A fact about the day now rather
          // than a charge of its own: it pushed the end of that person's day back.
          awayHours: sum(days, (day) => day.awayHours),
          // The one that is actually multiplied by the rate.
          shortHours: sum(days, (day) => day.shortHours),
          receiptTotal: sum(paid, (receipt) => receipt.countedAmount ?? 0),
          adjustmentTotal: sum(adjusted, (row) => row.amount),
        }),
      });
    }
  }

  return rows;
}

function sum<T>(items: T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
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
