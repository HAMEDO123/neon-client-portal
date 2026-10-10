import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  computePayroll,
  correctedReceiptCount,
  countedReceiptAmount,
  hourlyRate,
  isManagersFigure,
  periodLabel,
  periodOf,
  previousPeriod,
  readCountsBox,
  receiptPeriod,
  RECEIPT_CAP,
  round,
} from "@/lib/payroll";

describe("hourly rate", () => {
  it("divides a monthly salary by 26 days and 8 hours", () => {
    // 520 ÷ 26 ÷ 8 = 2.5
    assert.equal(hourlyRate(520, "MONTHLY"), 2.5);
  });

  it("divides a weekly salary by 6 days and 8 hours", () => {
    // 120 ÷ 6 ÷ 8 = 2.5 — the same day-rate, one week at a time.
    assert.equal(hourlyRate(120, "WEEKLY"), 2.5);
  });

  it("treats a missing or zero salary as no rate", () => {
    assert.equal(hourlyRate(0, "MONTHLY"), 0);
    assert.equal(hourlyRate(Number.NaN, "MONTHLY"), 0);
  });
});

describe("the month a receipt counts in", () => {
  // Both screens list this month's receipts and say each is "added to this
  // month's pay". Filed under the date printed on it instead, a receipt from
  // the 30th sent on the 6th vanished from the list it had just been sent from.
  it("is the month it was sent", () => {
    assert.equal(receiptPeriod("2026-10-06"), "2026-10");
    assert.equal(receiptPeriod("2026-01-01"), "2026-01");
  });

  it("is not moved by the date the reading finds on the receipt", () => {
    const action = readFileSync(join(process.cwd(), "src", "lib", "actions", "operations-actions.ts"), "utf8");
    assert.match(action, /periodMonth: receiptPeriod\(todayKey\(timezone\)\)/);
    assert.equal(/periodMonth:[^\n]*reading\.date/.test(action), false, "a receipt is being filed by its printed date again");
  });
});

describe("receipt cap", () => {
  it("caps anything at or above the cap", () => {
    assert.equal(countedReceiptAmount(2), RECEIPT_CAP);
    assert.equal(countedReceiptAmount(2.5), RECEIPT_CAP);
    assert.equal(countedReceiptAmount(17.4), RECEIPT_CAP);
  });

  it("counts anything below the cap as itself", () => {
    assert.equal(countedReceiptAmount(1.75), 1.75);
    assert.equal(countedReceiptAmount(0.4), 0.4);
  });

  it("ignores a receipt with no readable amount", () => {
    assert.equal(countedReceiptAmount(null), 0);
    assert.equal(countedReceiptAmount(undefined), 0);
    assert.equal(countedReceiptAmount(-3), 0);
  });
});

// The studio's rule: somebody on the team is never given more than the cap
// for a receipt, and the manager may make it three or four or whatever they
// like — the figure they type is the figure paid.
describe("what the manager says a receipt counts for", () => {
  const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");
  const auto = { rawAmount: 49.3, countedAmount: 2 };

  it("is paid as typed, above the cap and above what was paid", () => {
    assert.equal(correctedReceiptCount(auto, 49.3, 3), 3);
    assert.equal(correctedReceiptCount(auto, 49.3, 4), 4);
    assert.equal(correctedReceiptCount({ rawAmount: 1.5, countedAmount: 1.5 }, 1.5, 5), 5);
    assert.equal(correctedReceiptCount(auto, 49.3, 0), 0, "and a receipt can be made to count for nothing");
  });

  it("stays when something else on the receipt is corrected afterwards", () => {
    const raised = { rawAmount: 49.3, countedAmount: 4 };
    assert.equal(correctedReceiptCount(raised, 49.3, 4), 4);
    assert.equal(correctedReceiptCount(raised, 1.2, 4), 4, "the amount paid was corrected under it");
    // The phone app's form: a vendor and an amount, no box at all.
    assert.equal(correctedReceiptCount(raised, 49.3, undefined), 4);
    assert.equal(correctedReceiptCount(raised, 10, undefined), 4);
  });

  // The box opens holding what the receipt counts for. A misread 0.50
  // corrected to 5.00 must not go on paying 0.50 because the box said so.
  it("follows the amount paid while the box is left as it was", () => {
    const misread = { rawAmount: 0.5, countedAmount: 0.5 };
    assert.equal(correctedReceiptCount(misread, 5, 0.5), RECEIPT_CAP);
    assert.equal(correctedReceiptCount(auto, 1.25, 2), 1.25);
    assert.equal(correctedReceiptCount(auto, null, 2), 0);
    assert.equal(correctedReceiptCount(auto, 1.25, undefined), 1.25);
  });

  it("goes back to the cap's own answer when the box is emptied", () => {
    assert.equal(correctedReceiptCount({ rawAmount: 49.3, countedAmount: 4 }, 49.3, "auto"), RECEIPT_CAP);
    assert.equal(correctedReceiptCount({ rawAmount: 1.5, countedAmount: 0 }, 1.5, "auto"), 1.5);
  });

  // A receipt the reading failed on has no figure yet. Typing 0 beside a
  // corrected amount is the manager saying nothing is paid, not an untouched box.
  it("takes a figure typed on a receipt that never had one", () => {
    const unread = { rawAmount: null, countedAmount: null };
    assert.equal(correctedReceiptCount(unread, 5, 3), 3);
    assert.equal(correctedReceiptCount(unread, 5, 0), 0);
    assert.equal(correctedReceiptCount(unread, 5, "auto"), RECEIPT_CAP);
  });

  it("is told apart from the cap's answer by the two amounts alone", () => {
    assert.equal(isManagersFigure(49.3, 2), false);
    assert.equal(isManagersFigure(1.75, 1.75), false);
    assert.equal(isManagersFigure(null, 0), false);
    assert.equal(isManagersFigure(null, null), false);
    assert.equal(isManagersFigure(49.3, 4), true);
    assert.equal(isManagersFigure(49.3, 0), true);
    assert.equal(isManagersFigure(1.5, 2), true);
    assert.equal(isManagersFigure(null, 3), true);
    // Float dust is not a decision.
    assert.equal(isManagersFigure(0.1 + 0.2, 0.3), false);
  });

  // Number("") and Number(null) are both 0. Read that way, an emptied box and
  // a form with no box would each say "nothing is paid" — and the phone app,
  // which posts no box, would zero every receipt it saved.
  it("reads a figure, an emptied box and no box as three different things", () => {
    assert.equal(readCountsBox("3"), 3);
    assert.equal(readCountsBox(" 4.5 "), 4.5);
    assert.equal(readCountsBox("0"), 0);
    assert.equal(readCountsBox("2.3456"), 2.346);
    assert.equal(readCountsBox(""), "auto");
    assert.equal(readCountsBox("   "), "auto");
    assert.equal(readCountsBox(null), undefined);
    assert.equal(readCountsBox(undefined), undefined);
    assert.equal(readCountsBox("abc"), undefined);
    assert.equal(readCountsBox("-1"), undefined);
  });

  // The half of the rule nothing else would notice breaking: the cap is the
  // only thing that ever writes a figure for a receipt somebody sends in, and
  // the manager's figure is only ever read behind the manager's own guard.
  it("is only ever the manager's to type", () => {
    const actions = read("src", "lib", "actions", "operations-actions.ts");
    const sending = actions.slice(actions.indexOf("async function storeReceipt"), actions.indexOf("export async function deleteReceipt"));
    assert.match(sending, /countedAmount: countedReceiptAmount\(reading\.amount\)/);
    assert.equal(/formData\.get\("countedAmount"\)/.test(sending), false, "a figure is being read from the form somebody sends a receipt with");

    const correcting = actions.slice(actions.indexOf("export async function correctReceipt"));
    const body = correcting.slice(0, correcting.indexOf("\n}\n"));
    assert.match(body, /await requireAdmin\(\);/);
    assert.match(body, /correctedReceiptCount\(stored, amount, readCountsBox\(formData\.get\("countedAmount"\)\)\)/);
    assert.equal(actions.split('formData.get("countedAmount")').length - 1, 1, "the manager's box is read in more than one place");
  });

  it("has a box on the manager's screen and none on the screen a receipt is sent from", () => {
    assert.match(read("src", "app", "admin", "(dashboard)", "payroll", "page.tsx"), /name="countedAmount"/);
    assert.equal(/countedAmount"/.test(read("src", "components", "employee", "receipts.tsx").split("export function ReceiptList")[0]), false);
  });
});

describe("monthly payroll", () => {
  it("deducts the delay and adds the receipts", () => {
    const result = computePayroll({
      salaryAmount: 520,
      payBasis: "MONTHLY",
      delayHours: 3, earlyHours: 0,
      receiptTotal: 6,
    });

    assert.equal(result.hourlyRate, 2.5);
    assert.equal(result.cutoff, 7.5); // 2.5 × 3
    assert.equal(result.finalPay, 518.5); // 520 − 7.5 + 6
  });

  it("charges leaving early at the same rate as arriving late", () => {
    // 520 a month is 2.5 an hour: one hour lost at each end of the day is two
    // hours off, and it makes no difference which end they came from.
    const bothEnds = computePayroll({
      salaryAmount: 520,
      payBasis: "MONTHLY",
      delayHours: 1,
      earlyHours: 1,
      receiptTotal: 0,
    });

    assert.equal(bothEnds.lostHours, 2);
    assert.equal(bothEnds.cutoff, 5);
    assert.equal(bothEnds.finalPay, 515);

    // Kept apart on the breakdown, because a manager deciding whether a
    // deduction is fair needs to know which end it came from.
    assert.equal(bothEnds.delayHours, 1);
    assert.equal(bothEnds.earlyHours, 1);

    const lateOnly = computePayroll({
      salaryAmount: 520,
      payBasis: "MONTHLY",
      delayHours: 2,
      earlyHours: 0,
      receiptTotal: 0,
    });
    assert.equal(lateOnly.cutoff, bothEnds.cutoff, "two hours is two hours");
  });

  it("never lets leaving early turn into a debt", () => {
    // The cap is on everything together: a month of walking out at lunchtime
    // takes the salary to zero and no further.
    const result = computePayroll({
      salaryAmount: 100,
      payBasis: "MONTHLY",
      delayHours: 20,
      earlyHours: 200,
      receiptTotal: 0,
    });

    assert.equal(result.cutoff, 100);
    assert.equal(result.finalPay, 0);
  });

  it("pays the full salary when nobody was late", () => {
    const result = computePayroll({
      salaryAmount: 400,
      payBasis: "MONTHLY",
      delayHours: 0, earlyHours: 0,
      receiptTotal: 0,
    });
    assert.equal(result.cutoff, 0);
    assert.equal(result.finalPay, 400);
  });

  it("never deducts more than the salary", () => {
    // 1000 hours late is not a debt the employee owes.
    const result = computePayroll({
      salaryAmount: 300,
      payBasis: "MONTHLY",
      delayHours: 1000, earlyHours: 0,
      receiptTotal: 0,
    });
    assert.equal(result.cutoff, 300);
    assert.equal(result.finalPay, 0);
  });

  it("still reimburses receipts when the salary is fully deducted", () => {
    const result = computePayroll({
      salaryAmount: 300,
      payBasis: "MONTHLY",
      delayHours: 1000, earlyHours: 0,
      receiptTotal: 12,
    });
    assert.equal(result.finalPay, 12);
  });
});

describe("what came off the salary", () => {
  it("adds the lateness and the adjustments into one figure", () => {
    const result = computePayroll({
      salaryAmount: 520,
      payBasis: "MONTHLY",
      delayHours: 3, earlyHours: 0,
      receiptTotal: 6,
      adjustmentTotal: 2,
    });

    assert.equal(result.cutoff, 7.5);
    assert.equal(result.adjustmentTotal, 2);
    assert.equal(result.totalCut, 9.5);
  });

  it("is zero when nothing came off", () => {
    const result = computePayroll({
      salaryAmount: 350,
      payBasis: "MONTHLY",
      delayHours: 0, earlyHours: 0,
      receiptTotal: 0,
    });
    assert.equal(result.totalCut, 0);
  });

  it("never exceeds the salary, however much is thrown at it", () => {
    // The pay sheet shows this number on its own, so a figure bigger than the
    // salary would read as a debt — which no deduction here may become.
    const result = computePayroll({
      salaryAmount: 300,
      payBasis: "MONTHLY",
      delayHours: 1000, earlyHours: 0,
      receiptTotal: 0,
      adjustmentTotal: 500,
    });

    assert.equal(result.totalCut, 300);
    assert.equal(result.finalPay, 0);
  });

  it("is exactly what the salary less the pay, receipts aside, comes to", () => {
    // Rounded on both sides, because deriving the identity out of numbers that
    // have each already been rounded puts the float noise back in: this failed
    // once at 3.344 against 3.343999999999994.
    const result = computePayroll({
      salaryAmount: 75,
      payBasis: "WEEKLY",
      delayHours: 1.5, earlyHours: 0,
      receiptTotal: 4,
      adjustmentTotal: 1,
    });

    assert.equal(result.totalCut, round(result.salary - result.finalPay + result.receiptTotal));
  });
});

describe("weekly payroll", () => {
  it("uses the six-day week for the hourly rate", () => {
    const result = computePayroll({
      salaryAmount: 120,
      payBasis: "WEEKLY",
      delayHours: 2, earlyHours: 0,
      receiptTotal: 3.5,
    });

    assert.equal(result.workingDays, 6);
    assert.equal(result.hourlyRate, 2.5);
    assert.equal(result.cutoff, 5); // 2.5 × 2
    assert.equal(result.finalPay, 118.5); // 120 − 5 + 3.5
  });
});

describe("payroll periods", () => {
  it("takes the month from a day", () => {
    assert.equal(periodOf("2026-09-09"), "2026-09");
  });

  it("steps back over a year boundary", () => {
    assert.equal(previousPeriod("2026-01"), "2025-12");
    assert.equal(previousPeriod("2026-09"), "2026-08");
  });

  it("labels a period readably", () => {
    assert.equal(periodLabel("2026-08"), "August 2026");
  });
});
