"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-guard";
import { EMPLOYEE_COLORS } from "@/lib/task-board";
import { DEFAULT_SALES_TARGET } from "@/lib/sales";
import { dispatchNotification } from "@/lib/notifications/engine";

// Admin-only management of employee accounts. Each action re-checks the admin
// session: these are public POST endpoints, and the layout's redirect is a
// convenience for the browser, not a security boundary.

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
  // How this person is usually worked, for whoever plans their day.
  const playbook = String(formData.get("playbook") ?? "").trim().slice(0, 4000) || null;
  const skills = String(formData.get("skills") ?? "").trim().slice(0, 2000) || null;
  const examples = String(formData.get("examples") ?? "").trim().slice(0, 2000) || null;
  const reviewerId = String(formData.get("reviewerId") ?? "") || null;
  const capacityRaw = String(formData.get("dailyCapacityMinutes") ?? "").trim();

  if (!name) throw new Error("Full name is required.");
  if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
    throw new Error("That email address does not look valid.");
  }

  // An empty box means the default target rather than none at all.
  const target = targetRaw === "" ? DEFAULT_SALES_TARGET : Math.round(Number(targetRaw));
  if (!Number.isFinite(target) || target < 0) {
    throw new Error("The monthly sales target must be a whole number, zero or more.");
  }

  // An empty box means "no answer", which leaves the studio's day as it is. A
  // typed zero means the same thing: nobody has a working day of no minutes,
  // and reading it literally would propose an empty day for ever.
  const capacity = capacityRaw === "" ? null : Math.round(Number(capacityRaw));
  if (capacity !== null && (!Number.isFinite(capacity) || capacity < 0)) {
    throw new Error("The daily capacity must be a whole number of minutes, zero or more.");
  }

  return {
    name,
    email: emailRaw || null,
    role: role || null,
    phone: phone || null,
    employeeCode: employeeCode || null,
    monthlySalesTarget: target,
    playbook,
    skills,
    examples,
    dailyCapacityMinutes: capacity === 0 ? null : capacity,
    reviewerId,
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

  // Nobody reviews their own work. A select that offered it would be a mistake
  // waiting to be made, so the rule is enforced here rather than only hidden.
  await prisma.employee.update({
    where: { id },
    data: { ...fields, reviewerId: fields.reviewerId === id ? null : fields.reviewerId },
  });
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
