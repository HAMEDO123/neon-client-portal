"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-guard";
import { managerEmployeeId } from "@/lib/manager-account";

// Push for the manager's own phone.
//
// A deliberate mirror of savePushSubscription in employee-actions.ts rather
// than a new mechanism: the same table, the same upsert on endpoint, the same
// reset of active and failureCount. What differs is only who is asking —
// requireAdmin instead of requireEmployee — because the manager cannot sign in
// to the employee portal at all (employee-auth rejects any non-EMPLOYEE), and
// so could never reach the action that registers a device.
//
// The subscription is recorded against the manager's employee row, which is the
// same row the attendance device is paired to. That row is what makes them
// addressable by dispatchNotification; without it there is nowhere to put this.

export type AdminPushResult = { ok: true } | { ok: false; error: string };

export async function saveAdminPushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}): Promise<AdminPushResult> {
  await requireAdmin();

  if (!input?.endpoint || !input.p256dh || !input.auth) {
    return { ok: false, error: "The browser returned an incomplete subscription." };
  }

  const employeeId = await managerEmployeeId();
  if (!employeeId) {
    // Said plainly rather than swallowed: without that row there is no id to
    // address a notification to, and the fix is a specific one.
    return {
      ok: false,
      error:
        "There is no manager account to attach this phone to. Pair yourself to the attendance device first — that is what creates it.",
    };
  }

  // Endpoints are unique per device, so re-subscribing on a phone somebody else
  // used re-points the row rather than leaving it delivering to them.
  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      employeeId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
    },
    update: {
      employeeId,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      active: true,
      failureCount: 0,
    },
  });

  await prisma.notificationPreference.upsert({
    where: { employeeId },
    create: { employeeId, pushEnabled: true },
    update: { pushEnabled: true },
  });

  revalidatePath("/admin/settings");
  return { ok: true };
}

/** Gives up this phone, so nothing further arrives on it. */
export async function removeAdminPushSubscription(endpoint: string): Promise<AdminPushResult> {
  await requireAdmin();
  if (!endpoint) return { ok: false, error: "No device given." };

  const employeeId = await managerEmployeeId();
  if (!employeeId) return { ok: false, error: "There is no manager account." };

  // Scoped to the manager's own row: an endpoint belonging to somebody else
  // matches nothing rather than being deleted by whoever names it.
  await prisma.pushSubscription.deleteMany({ where: { endpoint, employeeId } });

  revalidatePath("/admin/settings");
  return { ok: true };
}

/** The manager's own registered phones, for the screen that manages them. */
export async function managerDevices() {
  await requireAdmin();

  const employeeId = await managerEmployeeId();
  if (!employeeId) return [];

  return prisma.pushSubscription.findMany({
    where: { employeeId },
    orderBy: { createdAt: "desc" },
    select: { id: true, endpoint: true, active: true, userAgent: true, createdAt: true, failureCount: true },
  });
}
