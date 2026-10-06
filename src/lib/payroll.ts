import type { PayBasis } from "@/generated/prisma/enums";

// Payroll arithmetic, kept pure so it can be tested exactly and so the rules
// live in one readable place rather than being spread across a page.
//
//   hourly rate  = salary ÷ working days ÷ 8
//   cutoff       = hourly rate × hours arrived late
//   total cut    = cutoff + adjustments
//   final pay    = salary − total cut + reimbursed receipts
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
  /**
   * Hours of the day left unworked at the end, from the clock-out.
   *
   * Required rather than defaulted: this is money, and a caller that has not
   * thought about it should be made to, not quietly charged zero. Zero is the
   * right answer for a day nobody clocked out of — it is just not a safe
   * default for a field somebody forgot.
   */
  earlyHours: number;
  receiptTotal: number;
  /** Deductions decided elsewhere — a performance shortfall, say. Positive is money off. */
  adjustmentTotal?: number;
};

export type PayrollBreakdown = {
  salary: number;
  basis: PayBasis;
  workingDays: number;
  hourlyRate: number;
  delayHours: number;
  earlyHours: number;
  /** The two together — what the hourly rate is actually multiplied by. */
  lostHours: number;
  cutoff: number;
  adjustmentTotal: number;
  /** Everything taken off the salary in this period — lateness and adjustments as one number. */
  totalCut: number;
  receiptTotal: number;
  finalPay: number;
};

export function computePayroll(input: PayrollInput): PayrollBreakdown {
  const salary = input.salaryAmount ?? 0;
  const rate = hourlyRate(salary, input.payBasis);
  const delayHours = Math.max(0, input.delayHours);
  const earlyHours = Math.max(0, input.earlyHours);
  // Both ends of the day cost the same hourly rate, so they are one number
  // before the multiplication. Kept apart in the breakdown, because a manager
  // deciding whether a deduction is fair wants to know which end it came from.
  const lostHours = delayHours + earlyHours;

  // Lost time can reduce the salary to nothing but never below it — a
  // deduction must not turn into a debt the employee owes.
  const cutoff = Math.min(round(rate * lostHours), salary);

  // Every deduction obeys the same limit together: lost time plus anything
  // else can take the salary to zero and no further.
  const adjustmentTotal = Math.min(round(Math.max(0, input.adjustmentTotal ?? 0)), salary - cutoff);
  const receiptTotal = Math.max(0, input.receiptTotal);

  return {
    salary: round(salary),
    basis: input.payBasis,
    workingDays: workingDaysFor(input.payBasis),
    hourlyRate: round(rate),
    delayHours: round(delayHours),
    earlyHours: round(earlyHours),
    lostHours: round(lostHours),
    cutoff,
    adjustmentTotal,
    // Every deduction added up, because "how much came off" is the question a
    // pay sheet is actually asked, and adding columns in your head is how it
    // gets answered wrongly. They are already capped together above, so this
    // can never exceed the salary.
    totalCut: round(cutoff + adjustmentTotal),
    receiptTotal: round(receiptTotal),
    // Reimbursements are added after the deduction: they are money the
    // employee already spent, not part of the salary being docked.
    finalPay: round(salary - cutoff - adjustmentTotal + receiptTotal),
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

/**
 * The pay month a receipt counts in: **the month it was sent**, whatever date
 * is printed on it.
 *
 * It used to follow the printed date, and that made sending a receipt look
 * broken. Both screens list "this month's" receipts and promise each is "added
 * to this month's pay" — so a receipt from the 30th sent on the 6th was read,
 * stored, filed under last month, and never appeared in the list it had just
 * been sent from. The owner's words were "I can't upload proof photos for the
 * receipts"; the table held three, one of them twice, because the natural
 * answer to a receipt that vanishes is to send it again. A misread year filed
 * one under 2024, where nobody would ever have opened it.
 *
 * It also decides money, which is why it is a function with a test rather than
 * an expression in an action: a receipt filed under a month whose pay is
 * already settled is a receipt nobody is paid for. The printed date is still
 * kept on the row (`receiptDate`) and shown to the manager, who can see a
 * months-old receipt for what it is and correct it.
 */
export function receiptPeriod(sentDayKey: string) {
  return periodOf(sentDayKey);
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
