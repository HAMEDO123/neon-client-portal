"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { requireEmployee } from "@/lib/employee-session";
import { taskForEmployee } from "@/lib/employee-tasks";
import { saveFile } from "@/lib/storage";
import { dispatchNotification } from "@/lib/notifications/engine";
import { taskUrl } from "@/lib/notifications/types";
import { notifyAdmin } from "@/lib/admin-notifications";

// Finishing a task is a claim, not a fact.
//
// An employee marks work done by sending a photo of it; the task then sits in
// SUBMITTED until the manager looks at the photo and accepts or returns it.
// Only the manager's approval writes DONE, so the board always reflects work
// somebody has actually seen.

async function requireAdmin() {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) {
    throw new Error("Unauthorized");
  }
}

function refresh(entryId?: string) {
  revalidatePath("/employee");
  revalidatePath("/employee/tasks");
  if (entryId) revalidatePath(`/employee/tasks/${entryId}`);
  revalidatePath("/admin/tasks");
  revalidatePath("/admin/reviews");
  revalidatePath("/admin/analytics");
}

/** The employee sends their evidence. */
export async function submitTaskCompletion(entryId: string, formData: FormData) {
  const employee = await requireEmployee();

  const task = await taskForEmployee(employee.id, entryId);
  if (!task) throw new Error("Task not found.");

  const photo = formData.get("photo");
  if (!(photo instanceof File) || photo.size === 0) {
    throw new Error("Attach a photo of the finished work.");
  }

  const saved = await saveFile(photo, `submissions/${employee.id}`, "image");
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000) || null;

  const submission = await prisma.taskSubmission.create({
    data: { entryId: task.id, employeeId: employee.id, imageUrl: saved.url, note },
  });

  // Not DONE — that word belongs to the manager.
  await prisma.projectTaskEntry.update({
    where: { id: task.id },
    data: { state: "SUBMITTED", completedAt: null },
  });

  await notifyAdmin({
    type: "TASK_SUBMITTED",
    title: `${employee.name} finished a task`,
    message: `${task.task.name} — ${task.project.name}. A photo is waiting for your review.`,
    url: "/admin/reviews",
    dedupeKey: `TASK_SUBMITTED:${submission.id}`,
    entryId: task.id,
    employeeId: employee.id,
  });

  refresh(entryId);
}

/** The manager accepts it: now it is done. */
export async function approveSubmission(submissionId: string, formData?: FormData) {
  await requireAdmin();

  const submission = await prisma.taskSubmission.update({
    where: { id: submissionId },
    data: {
      status: "APPROVED",
      reviewedAt: new Date(),
      reviewNote: String(formData?.get("reviewNote") ?? "").trim().slice(0, 500) || null,
    },
    include: { entry: { include: { task: { select: { name: true } } } } },
  });

  await prisma.projectTaskEntry.update({
    where: { id: submission.entryId },
    data: { state: "DONE", completedAt: new Date() },
  });

  await dispatchNotification({
    employeeId: submission.employeeId,
    type: "SYSTEM_NOTIFICATION",
    title: "Work approved",
    message: `${submission.entry.task.name} was approved.`,
    url: taskUrl(submission.entryId),
    entryId: submission.entryId,
    dedupeKey: `SUBMISSION_APPROVED:${submission.id}`,
  }).catch(() => {});

  refresh(submission.entryId);
}

/** The manager sends it back, with a reason. */
export async function rejectSubmission(submissionId: string, formData?: FormData) {
  await requireAdmin();

  const reason = String(formData?.get("reviewNote") ?? "").trim().slice(0, 500) || null;

  const submission = await prisma.taskSubmission.update({
    where: { id: submissionId },
    data: { status: "REJECTED", reviewedAt: new Date(), reviewNote: reason },
    include: { entry: { include: { task: { select: { name: true } } } } },
  });

  // Back to being worked on, not back to untouched: the employee has already
  // done something, and the history of the attempt is kept.
  await prisma.projectTaskEntry.update({
    where: { id: submission.entryId },
    data: { state: "IN_PROGRESS", completedAt: null },
  });

  await dispatchNotification({
    employeeId: submission.employeeId,
    type: "SYSTEM_NOTIFICATION",
    title: "Work sent back",
    message: reason
      ? `${submission.entry.task.name} needs more work: ${reason}`
      : `${submission.entry.task.name} was sent back for more work.`,
    url: taskUrl(submission.entryId),
    entryId: submission.entryId,
    dedupeKey: `SUBMISSION_REJECTED:${submission.id}`,
  }).catch(() => {});

  refresh(submission.entryId);
}
