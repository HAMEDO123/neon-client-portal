"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { dayKeyToDate } from "@/lib/time";
import { daysBetween } from "@/lib/week";
import { dispatchNotification } from "@/lib/notifications/engine";
import { DASHBOARD_PATH } from "@/lib/notifications/types";
import type { TaskPriority } from "@/generated/prisma/enums";

// Handing out work that is not part of any project.
//
// The manager writes what it is, who does it, and the days it runs over. That
// last part is the whole point of the week view: "two days to go and negotiate
// with the supplier" fills two cells, and everyone can see what those two days
// are already spent on.

async function requireAdmin() {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) {
    throw new Error("Unauthorized");
  }
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const PRIORITIES: TaskPriority[] = ["LOW", "MEDIUM", "HIGH"];

function refresh() {
  revalidatePath("/admin/tasks");
  revalidatePath("/employee", "layout");
}

/**
 * Reads the form into a job. The end day is whichever way round the two dates
 * were given, and a job with no end is a one-day job — nobody should have to
 * type the same date twice to say "today".
 */
function readForm(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  if (!title) throw new Error("Give the task a name.");

  const employeeId = String(formData.get("employeeId") ?? "").trim();
  if (!employeeId) throw new Error("Choose who it is for.");

  const startKey = String(formData.get("startDay") ?? "").trim();
  if (!DAY_KEY.test(startKey)) throw new Error("Pick the day it starts.");

  const endRaw = String(formData.get("endDay") ?? "").trim();
  const endKey = DAY_KEY.test(endRaw) ? endRaw : startKey;

  // A range typed backwards is the same range.
  const [from, to] = daysBetween(startKey, endKey) >= 0 ? [startKey, endKey] : [endKey, startKey];

  const priorityRaw = String(formData.get("priority") ?? "MEDIUM");
  const priority = PRIORITIES.includes(priorityRaw as TaskPriority)
    ? (priorityRaw as TaskPriority)
    : "MEDIUM";

  return {
    title,
    employeeId,
    note: String(formData.get("note") ?? "").trim().slice(0, 2000) || null,
    startDay: dayKeyToDate(from),
    endDay: dayKeyToDate(to),
    priority,
    days: daysBetween(from, to) + 1,
  };
}

export async function createAssignedTask(formData: FormData) {
  await requireAdmin();
  const input = readForm(formData);

  const employee = await prisma.employee.findFirst({
    where: { id: input.employeeId, active: true },
    select: { id: true },
  });
  if (!employee) throw new Error("That employee is not available.");

  const task = await prisma.assignedTask.create({
    data: {
      employeeId: input.employeeId,
      title: input.title,
      note: input.note,
      startDay: input.startDay,
      endDay: input.endDay,
      priority: input.priority,
    },
  });

  await dispatchNotification({
    employeeId: input.employeeId,
    type: "TASK_ASSIGNED",
    title: "New Task Assigned",
    message:
      input.days > 1
        ? `${input.title} — ${input.days} days.`
        : `${input.title} — today's job.`,
    url: DASHBOARD_PATH,
    dedupeKey: `ASSIGNED_TASK:${task.id}`,
    metadata: { days: input.days },
  }).catch(() => {
    // The work is recorded; a failed push must not undo that.
  });

  refresh();
  return { id: task.id };
}

export async function updateAssignedTask(id: string, formData: FormData) {
  await requireAdmin();
  const input = readForm(formData);

  const before = await prisma.assignedTask.findUnique({
    where: { id },
    select: { employeeId: true, title: true, startDay: true, endDay: true },
  });
  if (!before) throw new Error("That task no longer exists.");

  await prisma.assignedTask.update({
    where: { id },
    data: {
      employeeId: input.employeeId,
      title: input.title,
      note: input.note,
      startDay: input.startDay,
      endDay: input.endDay,
      priority: input.priority,
    },
  });

  // Handing it to somebody else is an assignment for them, not an edit.
  const movedPerson = before.employeeId !== input.employeeId;
  const movedDays =
    before.startDay.getTime() !== input.startDay.getTime() ||
    before.endDay.getTime() !== input.endDay.getTime();

  if (movedPerson || movedDays || before.title !== input.title) {
    await dispatchNotification({
      employeeId: input.employeeId,
      type: movedPerson ? "TASK_ASSIGNED" : "TASK_UPDATED",
      title: movedPerson ? "New Task Assigned" : "Task Updated",
      message: movedPerson ? `${input.title} — ${input.days} days.` : `"${input.title}" has changed.`,
      url: DASHBOARD_PATH,
      // Keyed on what it became, so re-saving the same thing is silent and a
      // real second edit is not.
      dedupeKey: `ASSIGNED_TASK_UPDATE:${id}:${input.employeeId}:${input.title}:${input.startDay.toISOString()}:${input.endDay.toISOString()}`,
    }).catch(() => {});
  }

  refresh();
}

export async function deleteAssignedTask(id: string) {
  await requireAdmin();
  await prisma.assignedTask.delete({ where: { id } }).catch(() => {});
  refresh();
}

/**
 * Dragging a job to another day, or onto somebody else.
 *
 * The span moves whole: a two-day job dropped on Wednesday runs Wednesday and
 * Thursday, because the point of picking it up is to say when it happens, not
 * how long it takes. Duration is changed by editing it.
 */
export async function moveAssignedTask(id: string, input: { days: number; employeeId?: string }) {
  await requireAdmin();

  const task = await prisma.assignedTask.findUnique({
    where: { id },
    select: { employeeId: true, title: true, startDay: true, endDay: true },
  });
  if (!task) throw new Error("That task no longer exists.");

  const shift = Math.round(input.days);
  const employeeId = input.employeeId ?? task.employeeId;

  if (shift === 0 && employeeId === task.employeeId) return;

  if (employeeId !== task.employeeId) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, active: true },
      select: { id: true },
    });
    if (!employee) throw new Error("That employee is not available.");
  }

  const startDay = new Date(task.startDay.getTime() + shift * DAY_MS);
  const endDay = new Date(task.endDay.getTime() + shift * DAY_MS);

  await prisma.assignedTask.update({
    where: { id },
    data: { employeeId, startDay, endDay },
  });

  const days = Math.round((endDay.getTime() - startDay.getTime()) / DAY_MS) + 1;

  await dispatchNotification({
    employeeId,
    type: employeeId === task.employeeId ? "TASK_UPDATED" : "TASK_ASSIGNED",
    title: employeeId === task.employeeId ? "Task moved" : "New Task Assigned",
    message:
      employeeId === task.employeeId
        ? `"${task.title}" moved to ${startDay.toISOString().slice(0, 10)}.`
        : `${task.title} — ${days} ${days === 1 ? "day" : "days"}.`,
    url: DASHBOARD_PATH,
    dedupeKey: `ASSIGNED_TASK_MOVE:${id}:${employeeId}:${startDay.toISOString()}`,
  }).catch(() => {});

  refresh();
}

/** The manager ticking one off from the week view. */
export async function setAssignedTaskState(id: string, state: "TODO" | "IN_PROGRESS" | "DONE") {
  await requireAdmin();

  await prisma.assignedTask.update({
    where: { id },
    data: { state, completedAt: state === "DONE" ? new Date() : null },
  });

  refresh();
}
