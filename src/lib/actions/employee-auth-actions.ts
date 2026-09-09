"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
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

  const employee = await prisma.employee.findUnique({ where: { email } });

  // One message for every failure: a wrong password, an unknown address and a
  // disabled account must be indistinguishable from outside.
  const invalid = { error: "Invalid email or password." };
  if (!employee?.passwordHash || !employee.active || employee.accessRole !== "EMPLOYEE") {
    // Spend the time anyway so a missing account is not detectably faster.
    await bcrypt.compare(password, "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
    return invalid;
  }

  const valid = await bcrypt.compare(password, employee.passwordHash);
  if (!valid) return invalid;

  await prisma.employee.update({ where: { id: employee.id }, data: { lastLoginAt: new Date() } });

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
