"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { notifyTaskAssigned, notifyTaskUpdated, snapshotOf } from "@/lib/notifications/events";
import { dayKeyToDate } from "@/lib/time";
import { getTimezone } from "@/lib/settings";
import type { TaskPriority } from "@/generated/prisma/enums";

// Admin-side scheduling of one board cell. This is the only place the admin
// portal has to touch: it saves the task and hands the change to the
// notification engine, which decides who hears about it and how.

async function requireAdmin() {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) {
    throw new Error("Unauthorized");
  }
}

const PRIORITIES: TaskPriority[] = ["LOW", "MEDIUM", "HIGH"];

const detailInclude = {
  task: { select: { id: true, name: true, employeeId: true } },
  project: { select: { name: true } },
} as const;

/**
 * Combines a day and a wall-clock time into an instant in the company
 * timezone. Doing this by hand rather than with `new Date("...")` keeps the
 * deadline correct no matter where the server is.
 */
function toInstant(dayKey: string, time: string, timeZone: string): Date | null {
  if (!dayKey || !time) return null;
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  const guess = new Date(`${dayKey}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00Z`);
  // Measure the zone's offset at that moment, then subtract it.
  const localised = new Date(guess.toLocaleString("en-US", { timeZone }));
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() - (localised.getTime() - utc.getTime()));
}

export async function updateTaskEntryDetails(projectId: string, taskId: string, formData: FormData) {
  await requireAdmin();
  const timezone = await getTimezone();

  const assigneeId = String(formData.get("assigneeId") ?? "") || null;
  const scheduledKey = String(formData.get("scheduledFor") ?? "").trim();
  const dueTime = String(formData.get("dueTime") ?? "").trim();
  const priorityRaw = String(formData.get("priority") ?? "MEDIUM");
  const priority = PRIORITIES.includes(priorityRaw as TaskPriority) ? (priorityRaw as TaskPriority) : "MEDIUM";
  const adminNote = String(formData.get("adminNote") ?? "").trim().slice(0, 2000) || null;

  const scheduledFor = scheduledKey ? dayKeyToDate(scheduledKey) : null;
  const dueAt = scheduledKey && dueTime ? toInstant(scheduledKey, dueTime, timezone) : null;

  const existing = await prisma.projectTaskEntry.findUnique({
    where: { projectId_taskId: { projectId, taskId } },
    include: detailInclude,
  });

  const before = existing ? snapshotOf(existing) : null;

  const entry = await prisma.projectTaskEntry.upsert({
    where: { projectId_taskId: { projectId, taskId } },
    create: { projectId, taskId, assigneeId, scheduledFor, dueAt, priority, adminNote },
    update: { assigneeId, scheduledFor, dueAt, priority, adminNote },
    include: detailInclude,
  });

  const after = snapshotOf(entry);

  // A cell that had no row yet is new work for whoever owns it; an existing
  // one is an update, and the engine drops it if nothing meaningful moved.
  if (!before) {
    await notifyTaskAssigned(entry.id);
  } else {
    await notifyTaskUpdated(entry.id, before, after);
  }

  revalidatePath("/admin/tasks");
  revalidatePath("/employee", "layout");
}

/** Clears scheduling without deleting the tick history. */
export async function clearTaskEntryDetails(projectId: string, taskId: string) {
  await requireAdmin();

  await prisma.projectTaskEntry.updateMany({
    where: { projectId, taskId },
    data: { scheduledFor: null, dueAt: null, adminNote: null, priority: "MEDIUM", assigneeId: null },
  });

  revalidatePath("/admin/tasks");
  revalidatePath("/employee", "layout");
}
