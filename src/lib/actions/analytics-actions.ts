"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { runPerformanceReview } from "@/lib/analytics-run";

export async function applyPerformanceDeductions(period: string) {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) throw new Error("Unauthorized");

  const result = await runPerformanceReview(period);

  revalidatePath("/admin/analytics");
  revalidatePath("/admin/payroll");
  return result;
}
