"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-guard";
import { runPerformanceReview } from "@/lib/analytics-run";

export async function applyPerformanceDeductions(period: string) {
  // This one writes money: a shortfall becomes a SalaryAdjustment against a real
  // person. The check is the shared one rather than a copy, so it cannot drift
  // apart from every other admin action.
  await requireAdmin();

  const result = await runPerformanceReview(period);

  revalidatePath("/admin/analytics");
  revalidatePath("/admin/payroll");
  return result;
}
