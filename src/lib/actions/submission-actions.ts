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
//
// The evidence is for one of two things — a cell on the project board, or a
// job the manager handed out by hand — and the review settles whichever it is.
// The employee's side of a hand-assigned job lives in my-assigned-actions.ts.

async function requireAdmin() {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) {
    throw new Error("Unauthorized");
  }
}

type Subject = { entryId: string | null; assignedTaskId: string | null };

function refresh(subject?: Subject) {
  revalidatePath("/employee");
  revalidatePath("/employee/tasks");
  if (subject?.entryId) revalidatePath(`/employee/tasks/${subject.entryId}`);
  if (subject?.assignedTaskId) revalidatePath(`/employee/assigned/${subject.assignedTaskId}`);
  revalidatePath("/admin/tasks");
  revalidatePath("/admin/reviews");
  revalidatePath("/admin/analytics");
}

/** The employee sends their evidence for a cell on the board. */
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

  refresh({ entryId, assignedTaskId: null });
}

const reviewInclude = {
  entry: { include: { task: { select: { name: true } } } },
  assignedTask: { select: { title: true } },
} as const;

/** What a submission is evidence for: its name, and the page the employee reads it on. */
function describe(submission: Subject & {
  entry: { task: { name: string } } | null;
  assignedTask: { title: string } | null;
}) {
  if (submission.entryId && submission.entry) {
    return { name: submission.entry.task.name, url: taskUrl(submission.entryId), entryId: submission.entryId };
  }
  return {
    name: submission.assignedTask?.title ?? "Your task",
    url: `/employee/assigned/${submission.assignedTaskId}`,
    entryId: null,
  };
}

/** Moves the work the evidence was for into its next state. */
async function settle(subject: Subject, state: "DONE" | "IN_PROGRESS") {
  const data = { state, completedAt: state === "DONE" ? new Date() : null };

  if (subject.entryId) {
    await prisma.projectTaskEntry.update({ where: { id: subject.entryId }, data });
  } else if (subject.assignedTaskId) {
    await prisma.assignedTask.update({ where: { id: subject.assignedTaskId }, data });
  }
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
    include: reviewInclude,
  });

  await settle(submission, "DONE");

  const subject = describe(submission);
  await dispatchNotification({
    employeeId: submission.employeeId,
    type: "SYSTEM_NOTIFICATION",
    title: "Work approved",
    message: `${subject.name} was approved.`,
    url: subject.url,
    entryId: subject.entryId,
    dedupeKey: `SUBMISSION_APPROVED:${submission.id}`,
  }).catch(() => {});

  refresh(submission);
}

/** The manager sends it back, with a reason. */
export async function rejectSubmission(submissionId: string, formData?: FormData) {
  await requireAdmin();

  const reason = String(formData?.get("reviewNote") ?? "").trim().slice(0, 500) || null;

  const submission = await prisma.taskSubmission.update({
    where: { id: submissionId },
    data: { status: "REJECTED", reviewedAt: new Date(), reviewNote: reason },
    include: reviewInclude,
  });

  // Back to being worked on, not back to untouched: the employee has already
  // done something, and the history of the attempt is kept.
  await settle(submission, "IN_PROGRESS");

  const subject = describe(submission);
  await dispatchNotification({
    employeeId: submission.employeeId,
    type: "SYSTEM_NOTIFICATION",
    title: "Work sent back",
    message: reason ? `${subject.name} needs more work: ${reason}` : `${subject.name} was sent back for more work.`,
    url: subject.url,
    entryId: subject.entryId,
    dedupeKey: `SUBMISSION_REJECTED:${submission.id}`,
  }).catch(() => {});

  refresh(submission);
}
