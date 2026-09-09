import { prisma } from "@/lib/db";
import { getEmployeeProgress } from "@/lib/analytics-queries";
import { PERFORMANCE_KIND, PERFORMANCE_PENALTY, shortfallReason } from "@/lib/analytics";
import { dispatchNotification } from "@/lib/notifications/engine";
import { DASHBOARD_PATH } from "@/lib/notifications/types";

// Applying the completion rule for a period.
//
// Anyone who finished less than the target share of their period's tasks has
// one JOD taken off and is told why, with the numbers. Two things make this
// safe to run repeatedly — from the Analytics page, or from the monthly cron:
//
//   * the SalaryAdjustment row is unique on (employee, period, kind), so a
//     second run deducts nothing;
//   * the notification carries a dedupe key on the same three things, so
//     nobody is told twice.
//
// It is therefore always the *first* run of a period that decides, and later
// runs only report what already happened.

export type PerformanceOutcome = {
  employeeId: string;
  name: string;
  completed: number;
  total: number;
  deducted: boolean;
  reason: string;
};

export async function runPerformanceReview(period: string) {
  const rows = await getEmployeeProgress(period);
  const outcomes: PerformanceOutcome[] = [];

  for (const row of rows) {
    // A disabled account is nobody's payroll problem.
    if (!row.shortfall || !row.employee.active) continue;

    const reason = shortfallReason(period, row.counts);

    let deducted = true;
    try {
      await prisma.salaryAdjustment.create({
        data: {
          employeeId: row.employee.id,
          periodKey: period,
          kind: PERFORMANCE_KIND,
          amount: PERFORMANCE_PENALTY,
          reason,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Already applied for this period — say so rather than doing it again.
      deducted = false;
    }

    if (deducted) {
      await dispatchNotification({
        employeeId: row.employee.id,
        type: "SYSTEM_NOTIFICATION",
        title: "Salary deduction",
        message: reason,
        url: DASHBOARD_PATH,
        dedupeKey: `${PERFORMANCE_KIND}:${row.employee.id}:${period}`,
        metadata: { period, completed: row.counts.completed, total: row.counts.total },
      }).catch(() => {
        // The money is recorded; a failed push must not undo that.
      });
    }

    outcomes.push({
      employeeId: row.employee.id,
      name: row.employee.name,
      completed: row.counts.completed,
      total: row.counts.total,
      deducted,
      reason,
    });
  }

  return { period, penalty: PERFORMANCE_PENALTY, outcomes };
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}
