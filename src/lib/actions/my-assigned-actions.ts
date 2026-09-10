"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireEmployee } from "@/lib/employee-session";
import { saveFile } from "@/lib/storage";
import { notifyAdmin } from "@/lib/admin-notifications";
import { EMPLOYEE_SETTABLE_STATES, EMPLOYEE_STATE_LABEL } from "@/lib/task-board";
import type { TaskState } from "@/generated/prisma/enums";

// What an employee can do with a job the manager handed to them directly.
//
// The same rules as a cell on the board, on purpose — two kinds of work with
// two sets of rules is how people end up unsure which one they are looking at.
// They move it between Pending and In Progress; finishing it means sending a
// photo, and only the manager's approval writes Done.
//
// The employee comes from the signed session, never from an argument, and every
// lookup is scoped to them: somebody else's job id matches nothing.

function refresh(id: string) {
  revalidatePath("/employee");
  revalidatePath("/employee/tasks");
  revalidatePath(`/employee/assigned/${id}`);
  revalidatePath("/admin/tasks");
  revalidatePath("/admin/reviews");
}

function mine(employeeId: string, id: string) {
  return prisma.assignedTask.findFirst({
    where: { id, employeeId },
    select: { id: true, title: true, state: true },
  });
}

export async function setMyAssignedTaskStatus(id: string, state: TaskState) {
  const employee = await requireEmployee();

  if (!EMPLOYEE_SETTABLE_STATES.includes(state)) {
    throw new Error("That status cannot be set from the employee portal.");
  }

  const task = await mine(employee.id, id);
  if (!task) throw new Error("Task not found.");

  // Once the photo is with the manager, the employee is no longer the one
  // moving this job around.
  if (task.state === "SUBMITTED" || task.state === "DONE") {
    throw new Error("This task is with the manager now.");
  }

  await prisma.assignedTask.update({ where: { id }, data: { state, completedAt: null } });

  if (task.state !== state) {
    await notifyAdmin({
      type: "TASK_STATUS_CHANGED",
      title: `${employee.name}: ${EMPLOYEE_STATE_LABEL[state]}`,
      message: `${task.title} moved from ${EMPLOYEE_STATE_LABEL[task.state]} to ${EMPLOYEE_STATE_LABEL[state]}.`,
      url: "/admin/tasks",
      dedupeKey: `ASSIGNED_STATUS:${id}:${state}:${Date.now()}`,
      employeeId: employee.id,
    });
  }

  refresh(id);
}

/** The employee sends their proof, and the job waits for the manager. */
export async function submitAssignedTaskCompletion(id: string, formData: FormData) {
  const employee = await requireEmployee();

  const task = await mine(employee.id, id);
  if (!task) throw new Error("Task not found.");
  if (task.state === "DONE") throw new Error("This task has already been approved.");

  const photo = formData.get("photo");
  if (!(photo instanceof File) || photo.size === 0) {
    throw new Error("Attach a photo of the finished work.");
  }

  const saved = await saveFile(photo, `submissions/${employee.id}`, "image");
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000) || null;

  const submission = await prisma.taskSubmission.create({
    data: { assignedTaskId: task.id, employeeId: employee.id, imageUrl: saved.url, note },
  });

  // Not DONE — that word belongs to the manager.
  await prisma.assignedTask.update({ where: { id }, data: { state: "SUBMITTED", completedAt: null } });

  await notifyAdmin({
    type: "TASK_SUBMITTED",
    title: `${employee.name} finished a task`,
    message: `${task.title}. A photo is waiting for your review.`,
    url: "/admin/reviews",
    dedupeKey: `TASK_SUBMITTED:${submission.id}`,
    employeeId: employee.id,
  });

  refresh(id);
}
