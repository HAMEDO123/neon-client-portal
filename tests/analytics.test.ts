import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  asPercent,
  isShortfall,
  PERFORMANCE_PENALTY,
  PERFORMANCE_THRESHOLD,
  progressOf,
  shortfallReason,
  timelinessOf,
  type ProgressCounts,
} from "../src/lib/analytics";
import { computePayroll } from "../src/lib/payroll";

function counts(overrides: Partial<ProgressCounts> = {}): ProgressCounts {
  return {
    total: 0,
    completed: 0,
    awaitingReview: 0,
    inProgress: 0,
    pending: 0,
    overdue: 0,
    onTime: 0,
    ...overrides,
  };
}

describe("progress", () => {
  it("is finished work over assigned work", () => {
    assert.equal(progressOf({ total: 10, completed: 9 }), 0.9);
    assert.equal(asPercent(progressOf({ total: 8, completed: 6 })), 75);
  });

  it("scores an empty board as complete rather than as failure", () => {
    // A new hire with nothing assigned has not failed at anything, and must
    // not be docked for it.
    assert.equal(progressOf({ total: 0, completed: 0 }), 1);
    assert.equal(isShortfall(counts()), false);
  });

  it("measures punctuality only among what was finished", () => {
    assert.equal(timelinessOf({ completed: 4, onTime: 3 }), 0.75);
    assert.equal(timelinessOf({ completed: 0, onTime: 0 }), 1);
  });
});

describe("the 90% rule", () => {
  it("bites below the threshold and not at it", () => {
    assert.equal(PERFORMANCE_THRESHOLD, 0.9);
    // Exactly on target is on target.
    assert.equal(isShortfall(counts({ total: 10, completed: 9 })), false);
    assert.equal(isShortfall(counts({ total: 10, completed: 8 })), true);
  });

  it("states the numbers behind a deduction", () => {
    const reason = shortfallReason("2026-09", counts({ total: 10, completed: 7 }));
    assert.match(reason, /September 2026/);
    assert.match(reason, /7 of 10/);
    assert.match(reason, /70%/);
    assert.match(reason, /90% target/);
    assert.match(reason, /1\.00 JOD/);
  });
});

describe("a performance deduction on a payslip", () => {
  it("comes off the salary, after lateness and before receipts", () => {
    const pay = computePayroll({
      salaryAmount: 520,
      payBasis: "MONTHLY",
      delayHours: 0,
      receiptTotal: 12,
      adjustmentTotal: PERFORMANCE_PENALTY,
    });

    assert.equal(pay.adjustmentTotal, 1);
    assert.equal(pay.finalPay, 531);
  });

  it("cannot take pay below zero, however many deductions land", () => {
    const pay = computePayroll({
      salaryAmount: 100,
      payBasis: "MONTHLY",
      // Enough lateness on its own to wipe out the salary.
      delayHours: 500,
      receiptTotal: 0,
      adjustmentTotal: 25,
    });

    assert.equal(pay.cutoff, 100);
    assert.equal(pay.adjustmentTotal, 0);
    assert.equal(pay.finalPay, 0);
  });

  it("ignores a negative adjustment rather than paying a bonus by accident", () => {
    const pay = computePayroll({
      salaryAmount: 300,
      payBasis: "MONTHLY",
      delayHours: 0,
      receiptTotal: 0,
      adjustmentTotal: -50,
    });

    assert.equal(pay.adjustmentTotal, 0);
    assert.equal(pay.finalPay, 300);
  });
});
