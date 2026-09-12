"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { EMPLOYEE_COLORS } from "@/lib/task-board";
import { DEFAULT_SALES_TARGET } from "@/lib/sales";
import { dispatchNotification } from "@/lib/notifications/engine";

// Admin-only management of employee accounts. Each action re-checks the admin
// session: these are public POST endpoints, and the layout's redirect is a
// convenience for the browser, not a security boundary.

async function requireAdmin() {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) {
    throw new Error("Unauthorized");
  }
}

function refresh() {
  revalidatePath("/admin/employees");
  revalidatePath("/admin/tasks");
}

const MIN_PASSWORD_LENGTH = 8;

function readAccountFields(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const emailRaw = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const employeeCode = String(formData.get("employeeCode") ?? "").trim();
  const targetRaw = String(formData.get("monthlySalesTarget") ?? "").trim();

  if (!name) throw new Error("Full name is required.");
  if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
    throw new Error("That email address does not look valid.");
  }

  // An empty box means the default target rather than none at all.
  const target = targetRaw === "" ? DEFAULT_SALES_TARGET : Math.round(Number(targetRaw));
  if (!Number.isFinite(target) || target < 0) {
    throw new Error("The monthly sales target must be a whole number, zero or more.");
  }

  return {
    name,
    email: emailRaw || null,
    role: role || null,
    phone: phone || null,
    employeeCode: employeeCode || null,
    monthlySalesTarget: target,
  };
}

async function hashPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  return bcrypt.hash(password, 10);
}

export async function createEmployeeAccount(formData: FormData) {
  await requireAdmin();
  const fields = readAccountFields(formData);
  const password = String(formData.get("password") ?? "");

  if (fields.email && !password) throw new Error("Set a password for the account.");

  const existing = fields.email
    ? await prisma.employee.findUnique({ where: { email: fields.email } })
    : null;
  if (existing) throw new Error("An employee with that email already exists.");

  const count = await prisma.employee.count();

  await prisma.employee.create({
    data: {
      ...fields,
      passwordHash: password ? await hashPassword(password) : null,
      color: EMPLOYEE_COLORS[count % EMPLOYEE_COLORS.length],
      order: count,
      // Defaults are created up front so the engine never has to guess what
      // someone wants before they have visited their settings.
      preference: { create: {} },
    },
  });

  refresh();
}

export async function updateEmployeeAccount(id: string, formData: FormData) {
  await requireAdmin();
  const fields = readAccountFields(formData);

  if (fields.email) {
    const clash = await prisma.employee.findFirst({
      where: { email: fields.email, NOT: { id } },
      select: { id: true },
    });
    if (clash) throw new Error("Another employee already uses that email.");
  }

  await prisma.employee.update({ where: { id }, data: fields });
  refresh();
}

export async function setEmployeeActive(id: string, active: boolean) {
  await requireAdmin();
  await prisma.employee.update({ where: { id }, data: { active } });

  if (!active) {
    // Sessions are checked against `active` on every request, so disabling is
    // immediate. Retiring the devices as well stops a disabled account's phone
    // from buzzing with anything already queued.
    await prisma.pushSubscription.updateMany({ where: { employeeId: id }, data: { active: false } });
  }

  refresh();
}

export async function resetEmployeePassword(id: string, formData: FormData) {
  await requireAdmin();
  const password = String(formData.get("password") ?? "");
  const passwordHash = await hashPassword(password);

  await prisma.employee.update({ where: { id }, data: { passwordHash } });

  await dispatchNotification({
    employeeId: id,
    type: "SYSTEM_NOTIFICATION",
    title: "Password changed",
    message: "An administrator set a new password for your account.",
    url: "/employee/profile",
    dedupeKey: `SYSTEM_NOTIFICATION:password:${id}:${Date.now()}`,
  }).catch(() => {});

  refresh();
}

/** Frees the email/password without deleting the person from the board. */
export async function revokeEmployeeAccount(id: string) {
  await requireAdmin();
  await prisma.employee.update({
    where: { id },
    data: { email: null, passwordHash: null, active: false },
  });
  await prisma.pushSubscription.updateMany({ where: { employeeId: id }, data: { active: false } });
  refresh();
}
