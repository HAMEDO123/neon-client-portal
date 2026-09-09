import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computePayroll,
  countedReceiptAmount,
  hourlyRate,
  periodLabel,
  periodOf,
  previousPeriod,
  RECEIPT_CAP,
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

describe("monthly payroll", () => {
  it("deducts the delay and adds the receipts", () => {
    const result = computePayroll({
      salaryAmount: 520,
      payBasis: "MONTHLY",
      delayHours: 3,
      receiptTotal: 6,
    });

    assert.equal(result.hourlyRate, 2.5);
    assert.equal(result.cutoff, 7.5); // 2.5 × 3
    assert.equal(result.finalPay, 518.5); // 520 − 7.5 + 6
  });

  it("pays the full salary when nobody was late", () => {
    const result = computePayroll({
      salaryAmount: 400,
      payBasis: "MONTHLY",
      delayHours: 0,
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
      delayHours: 1000,
      receiptTotal: 0,
    });
    assert.equal(result.cutoff, 300);
    assert.equal(result.finalPay, 0);
  });

  it("still reimburses receipts when the salary is fully deducted", () => {
    const result = computePayroll({
      salaryAmount: 300,
      payBasis: "MONTHLY",
      delayHours: 1000,
      receiptTotal: 12,
    });
    assert.equal(result.finalPay, 12);
  });
});

describe("weekly payroll", () => {
  it("uses the six-day week for the hourly rate", () => {
    const result = computePayroll({
      salaryAmount: 120,
      payBasis: "WEEKLY",
      delayHours: 2,
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
