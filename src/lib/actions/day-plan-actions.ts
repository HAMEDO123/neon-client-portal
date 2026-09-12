"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { proposeDay, type DayPlanResult } from "@/lib/ai/day-plan";

// Asking for a proposed day. Admin only, and it writes nothing — but it still
// checks the session, because a server action is a public endpoint and this one
// would otherwise read out an employee's whole workload to anybody who called
// it.

async function requireAdmin() {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) {
    throw new Error("Unauthorized");
  }
}

export async function planEmployeeDay(employeeId: string, dayKey: string): Promise<DayPlanResult> {
  await requireAdmin();
  return proposeDay(employeeId, dayKey);
}
