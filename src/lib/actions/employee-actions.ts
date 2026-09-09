"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireEmployee } from "@/lib/employee-session";
import { taskForEmployee } from "@/lib/employee-tasks";
import { EMPLOYEE_SETTABLE_STATES } from "@/lib/task-board";
import type { TaskState } from "@/generated/prisma/enums";

// Everything an employee is allowed to change, and nothing else.
//
// Two rules hold across this file:
//   1. The employee is taken from the signed session, never from an argument.
//   2. Every write is scoped by ownership, so an id belonging to someone else
//      simply matches no rows.

function refresh(entryId?: string) {
  revalidatePath("/employee");
  revalidatePath("/employee/tasks");
  if (entryId) revalidatePath(`/employee/tasks/${entryId}`);
}

export async function setMyTaskStatus(entryId: string, state: TaskState) {
  const employee = await requireEmployee();

  // Employees move work between Pending / In Progress / Completed. TOMORROW is
  // an admin planning marker and is not settable here.
  if (!EMPLOYEE_SETTABLE_STATES.includes(state)) {
    throw new Error("That status cannot be set from the employee portal.");
  }

  const task = await taskForEmployee(employee.id, entryId);
  if (!task) throw new Error("Task not found.");

  await prisma.projectTaskEntry.update({
    where: { id: task.id },
    data: {
      state,
      completedAt: state === "DONE" ? new Date() : null,
      startedAt: state === "IN_PROGRESS" ? (task.startedAt ?? new Date()) : task.startedAt,
    },
  });

  refresh(entryId);
}

export async function saveMyTaskNote(entryId: string, formData: FormData) {
  const employee = await requireEmployee();

  const task = await taskForEmployee(employee.id, entryId);
  if (!task) throw new Error("Task not found.");

  const note = String(formData.get("employeeNote") ?? "").trim().slice(0, 2000);

  // Only the employee's own note field — the admin note, assignment, dates and
  // priority are not writable from here.
  await prisma.projectTaskEntry.update({
    where: { id: task.id },
    data: { employeeNote: note || null },
  });

  refresh(entryId);
}

export async function markNotificationRead(notificationId: string) {
  const employee = await requireEmployee();

  // Scoped by employeeId: another employee's notification matches nothing.
  await prisma.notification.updateMany({
    where: { id: notificationId, employeeId: employee.id, readAt: null },
    data: { readAt: new Date() },
  });

  revalidatePath("/employee/notifications");
  revalidatePath("/employee");
}

export async function markAllNotificationsRead() {
  const employee = await requireEmployee();

  await prisma.notification.updateMany({
    where: { employeeId: employee.id, readAt: null },
    data: { readAt: new Date() },
  });

  revalidatePath("/employee/notifications");
  revalidatePath("/employee");
}

export async function saveNotificationPreferences(formData: FormData) {
  const employee = await requireEmployee();

  const flag = (name: string) => formData.get(name) === "on";
  const lead = Number(formData.get("deadlineLeadMinutes") ?? 120);

  const data = {
    pushEnabled: flag("pushEnabled"),
    taskAssigned: flag("taskAssigned"),
    taskUpdated: flag("taskUpdated"),
    todaySchedule: flag("todaySchedule"),
    tomorrowSchedule: flag("tomorrowSchedule"),
    deadlineReminders: flag("deadlineReminders"),
    deadlineLeadMinutes: Number.isFinite(lead) ? Math.min(Math.max(Math.round(lead), 5), 1440) : 120,
  };

  await prisma.notificationPreference.upsert({
    where: { employeeId: employee.id },
    create: { employeeId: employee.id, ...data },
    update: data,
  });

  revalidatePath("/employee/profile");
}

// --- Push subscriptions ----------------------------------------------------

export async function savePushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}) {
  const employee = await requireEmployee();

  if (!input?.endpoint || !input.p256dh || !input.auth) {
    throw new Error("Incomplete push subscription.");
  }

  // Endpoints are unique per device. Re-subscribing on a device that has been
  // handed to someone else re-points the row at the current employee rather
  // than leaving it delivering to the wrong person.
  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      employeeId: employee.id,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
    },
    update: {
      employeeId: employee.id,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      active: true,
      failureCount: 0,
    },
  });

  await prisma.notificationPreference.upsert({
    where: { employeeId: employee.id },
    create: { employeeId: employee.id, pushEnabled: true },
    update: { pushEnabled: true },
  });

  revalidatePath("/employee/profile");
  return { ok: true as const };
}

export async function removePushSubscription(endpoint: string) {
  const employee = await requireEmployee();

  await prisma.pushSubscription.deleteMany({
    where: { endpoint, employeeId: employee.id },
  });

  revalidatePath("/employee/profile");
  return { ok: true as const };
}
