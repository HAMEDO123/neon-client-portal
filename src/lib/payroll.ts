import type { PayBasis } from "@/generated/prisma/enums";

// Payroll arithmetic, kept pure so it can be tested exactly and so the rules
// live in one readable place rather than being spread across a page.
//
//   hourly rate  = salary ÷ working days ÷ 8
//   cutoff       = hourly rate × hours arrived late
//   final pay    = salary − cutoff + reimbursed receipts
//
// Monthly staff divide by 26 working days. Weekly staff divide by 6 — the
// same six-day week, one week at a time.

export const MONTHLY_WORKING_DAYS = 26;
export const WEEKLY_WORKING_DAYS = 6;
export const WORKING_HOURS_PER_DAY = 8;

/** A single receipt is reimbursed up to this much, per company rule. */
export const RECEIPT_CAP = 2;

export function workingDaysFor(basis: PayBasis) {
  return basis === "WEEKLY" ? WEEKLY_WORKING_DAYS : MONTHLY_WORKING_DAYS;
}

export function hourlyRate(salaryAmount: number, basis: PayBasis) {
  if (!Number.isFinite(salaryAmount) || salaryAmount <= 0) return 0;
  return salaryAmount / workingDaysFor(basis) / WORKING_HOURS_PER_DAY;
}

/**
 * What one receipt contributes. Anything at or above the cap counts as the
 * cap; anything below counts as itself. A receipt with no readable amount
 * contributes nothing until someone fills the amount in.
 */
export function countedReceiptAmount(rawAmount: number | null | undefined) {
  if (rawAmount == null || !Number.isFinite(rawAmount) || rawAmount <= 0) return 0;
  return Math.min(rawAmount, RECEIPT_CAP);
}

export type PayrollInput = {
  salaryAmount: number | null;
  payBasis: PayBasis;
  delayHours: number;
  receiptTotal: number;
};

export type PayrollBreakdown = {
  salary: number;
  basis: PayBasis;
  workingDays: number;
  hourlyRate: number;
  delayHours: number;
  cutoff: number;
  receiptTotal: number;
  finalPay: number;
};

export function computePayroll(input: PayrollInput): PayrollBreakdown {
  const salary = input.salaryAmount ?? 0;
  const rate = hourlyRate(salary, input.payBasis);
  const delayHours = Math.max(0, input.delayHours);

  // Lateness can reduce the salary to nothing but never below it — a deduction
  // must not turn into a debt the employee owes.
  const cutoff = Math.min(round(rate * delayHours), salary);
  const receiptTotal = Math.max(0, input.receiptTotal);

  return {
    salary: round(salary),
    basis: input.payBasis,
    workingDays: workingDaysFor(input.payBasis),
    hourlyRate: round(rate),
    delayHours: round(delayHours),
    cutoff,
    receiptTotal: round(receiptTotal),
    // Reimbursements are added after the deduction: they are money the
    // employee already spent, not part of the salary being docked.
    finalPay: round(salary - cutoff + receiptTotal),
  };
}

/** Money, to fils. */
export function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

/** The payroll month a date belongs to, as YYYY-MM. */
export function periodOf(dayKey: string) {
  return dayKey.slice(0, 7);
}

/** The previous month relative to a YYYY-MM period. */
export function previousPeriod(period: string) {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function periodLabel(period: string) {
  const [year, month] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1))
  );
}

/** The first and last instant of a YYYY-MM period, as calendar dates. */
export function periodRange(period: string) {
  const [year, month] = period.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}
