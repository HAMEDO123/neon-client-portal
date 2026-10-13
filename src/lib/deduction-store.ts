import { prisma } from "@/lib/db";
import { periodOf } from "@/lib/payroll";
import { dayKeyToDate } from "@/lib/time";
import { HOURS_PER_TASK, hoursAsMoney, taskDedupe } from "@/lib/task-cutoff";

// The database side of deductions (lib/task-cutoff.ts has the rules).
// Deliberately not "use server": these trust their caller to have checked who
// is asking.

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

/** Everything taken off in a pay period, newest first — taken-back ones included, marked. */
export function deductionsForPeriod(period: string) {
  return prisma.deduction.findMany({
    where: { periodKey: period },
    orderBy: { createdAt: "desc" },
    include: { employee: { select: { id: true, name: true } } },
    take: 300,
  });
}

/** What counts towards pay: everything not taken back. */
export function liveDeductions(period: string) {
  return prisma.deduction.findMany({
    where: { periodKey: period, cancelledAt: null },
    select: { employeeId: true, amount: true, reason: true },
  });
}

/**
 * The manager's own cutoff. Hours are priced at the person's rate now and the
 * money is fixed on the row, so what they were told is what comes off.
 */
export async function addManualDeduction(input: {
  employeeId: string;
  dayKey: string;
  hours: number | null;
  amount: number | null;
  reason: string;
}) {
  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, salaryAmount: true, payBasis: true },
  });
  if (!employee) return null;

  const amount =
    input.hours != null ? hoursAsMoney(employee.salaryAmount, employee.payBasis, input.hours) : (input.amount ?? 0);

  return prisma.deduction.create({
    data: {
      employeeId: employee.id,
      day: dayKeyToDate(input.dayKey),
      periodKey: periodOf(input.dayKey),
      kind: "MANUAL",
      hours: input.hours,
      amount,
      reason: input.reason,
    },
  });
}

/**
 * One hour for one job not handed in. False when it was already charged: the
 * unique key is what makes a pass that runs twice charge once.
 */
export async function chargeLateTask(
  task: { id: string; title: string },
  employee: { id: string; salaryAmount: number | null; payBasis: "MONTHLY" | "WEEKLY" },
  dayKey: string
) {
  try {
    await prisma.deduction.create({
      data: {
        employeeId: employee.id,
        day: dayKeyToDate(dayKey),
        periodKey: periodOf(dayKey),
        kind: "TASK",
        hours: HOURS_PER_TASK,
        amount: hoursAsMoney(employee.salaryAmount, employee.payBasis, HOURS_PER_TASK),
        reason: `Not handed in by 9:00 PM: ${task.title}`.slice(0, 300),
        assignedTaskId: task.id,
        dedupeKey: taskDedupe(task.id),
      },
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/** Taken back by the manager. Answers the row as it was, or null if it was not live. */
export async function cancelDeduction(id: string) {
  const row = await prisma.deduction.findUnique({ where: { id } });
  if (!row || row.cancelledAt) return null;
  await prisma.deduction.update({ where: { id }, data: { cancelledAt: new Date() } });
  return row;
}
