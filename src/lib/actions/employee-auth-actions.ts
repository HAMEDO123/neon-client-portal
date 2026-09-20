"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyEmployeeCredentials } from "@/lib/employee-credentials";
import {
  createEmployeeSessionToken,
  EMPLOYEE_SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth";

// Employee sign-in. Same shape as the admin login action, against per-account
// credentials instead of one shared password.

export async function employeeLogin(
  _prevState: { error?: string } | undefined,
  formData: FormData
): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  // One message for every failure: a wrong password, an unknown address and a
  // disabled account must be indistinguishable from outside. The check itself
  // lives in lib/employee-credentials.ts, shared with the mobile API.
  const employee = await verifyEmployeeCredentials(email, password);
  if (!employee) return { error: "Invalid email or password." };

  const store = await cookies();
  store.set(EMPLOYEE_SESSION_COOKIE_NAME, createEmployeeSessionToken(employee.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  redirect("/employee");
}

export async function employeeLogout() {
  const store = await cookies();
  store.delete(EMPLOYEE_SESSION_COOKIE_NAME);
  redirect("/employee/login");
}
