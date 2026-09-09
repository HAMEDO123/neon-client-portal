"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireEmployee } from "@/lib/employee-session";

// Which person a device belongs to.
//
// A push subscription is a property of the browser, not of the account: it
// survives signing out, and the phone keeps receiving whatever the row says.
// So when Wael signed out of the studio phone and Sally signed in, Wael's tasks
// carried on arriving on a phone Sally was holding.
//
// Ownership is therefore re-established on every load of the portal: the device
// belongs to whoever is signed in on it, and signing out gives it up. Every
// write is scoped to the session's employee, never to an id from the caller.

/**
 * The signed-in employee takes this device.
 *
 * Called whenever the portal loads with a live browser subscription. Usually it
 * changes nothing; the case it exists for is the row still naming the last
 * person to use this phone.
 */
export async function claimDevice(endpoint: string, userAgent?: string) {
  const employee = await requireEmployee();
  if (!endpoint) return { changed: false as const };

  const existing = await prisma.pushSubscription.findUnique({
    where: { endpoint },
    select: { id: true, employeeId: true, active: true },
  });

  // A device nobody has registered is not this action's business — enabling
  // push is what creates the row, and it does so with its keys.
  if (!existing) return { changed: false as const };

  if (existing.employeeId === employee.id && existing.active) {
    return { changed: false as const };
  }

  await prisma.pushSubscription.update({
    where: { endpoint },
    data: {
      employeeId: employee.id,
      // Handed to a new person, it starts clean rather than inheriting the
      // previous owner's failures.
      active: true,
      failureCount: 0,
      userAgent: userAgent?.slice(0, 300) ?? undefined,
    },
  });

  revalidatePath("/employee/profile");
  return { changed: true as const, from: existing.employeeId };
}

/**
 * Gives up this device, so nothing further arrives on it.
 *
 * Deleted rather than deactivated: the browser is unsubscribing at the same
 * moment, so the endpoint is about to stop existing, and a row for a dead
 * endpoint is only something to trip over later.
 */
export async function releaseDevice(endpoint: string) {
  const employee = await requireEmployee();
  if (!endpoint) return;

  // Scoped to this employee: an endpoint belonging to somebody else matches
  // nothing rather than being deleted by whoever guesses it.
  await prisma.pushSubscription.deleteMany({ where: { endpoint, employeeId: employee.id } });

  revalidatePath("/employee/profile");
}

/** Turning one of your own devices off without turning push off everywhere. */
export async function setDeviceActive(id: string, active: boolean) {
  const employee = await requireEmployee();

  await prisma.pushSubscription.updateMany({
    where: { id, employeeId: employee.id },
    data: { active, failureCount: active ? 0 : undefined },
  });

  revalidatePath("/employee/profile");
}

/** Forgetting a device you no longer have. */
export async function forgetDevice(id: string) {
  const employee = await requireEmployee();

  await prisma.pushSubscription.deleteMany({ where: { id, employeeId: employee.id } });

  revalidatePath("/employee/profile");
}
