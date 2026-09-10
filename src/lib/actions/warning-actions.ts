"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { issueWarning, withdrawWarning } from "@/lib/employee-warnings";

// The manager's warnings. Each action re-checks the admin session: these are
// public POST endpoints, and the layout's redirect is not a security boundary.

async function requireAdmin() {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) {
    throw new Error("Unauthorized");
  }
}

function refresh(employeeId: string) {
  revalidatePath("/admin/employees");
  revalidatePath(`/admin/employees/${employeeId}`);
  revalidatePath("/employee");
}

export async function giveWarning(employeeId: string, formData: FormData) {
  await requireAdmin();
  await issueWarning(employeeId, String(formData.get("reason") ?? ""));
  refresh(employeeId);
}

export async function removeWarning(employeeId: string, warningId: string) {
  await requireAdmin();
  await withdrawWarning(warningId);
  refresh(employeeId);
}
