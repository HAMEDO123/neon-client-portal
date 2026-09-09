"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { EMPLOYEE_COLORS } from "@/lib/task-board";
import type { TaskState } from "@/generated/prisma/enums";

// Every action here is a public POST endpoint, so the admin session is checked
// inside the action rather than relying on the dashboard layout's redirect.
async function requireAdmin() {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value)) {
    throw new Error("Unauthorized");
  }
}

function refresh() {
  revalidatePath("/admin/tasks");
}

const VALID_STATES: TaskState[] = ["TODO", "DONE", "TOMORROW"];

export async function setTaskState(projectId: string, taskId: string, state: TaskState) {
  await requireAdmin();
  if (!VALID_STATES.includes(state)) throw new Error("Unknown task state.");

  await prisma.projectTaskEntry.upsert({
    where: { projectId_taskId: { projectId, taskId } },
    create: { projectId, taskId, state, completedAt: state === "DONE" ? new Date() : null },
    update: { state, completedAt: state === "DONE" ? new Date() : null },
  });

  refresh();
}

// Clearing a project's row is the "start this one over" escape hatch when a
// whole line was ticked by mistake.
export async function resetProjectTasks(projectId: string) {
  await requireAdmin();
  await prisma.projectTaskEntry.deleteMany({ where: { projectId } });
  refresh();
}

export async function createEmployee(name: string) {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A name is required.");

  const count = await prisma.employee.count();
  await prisma.employee.create({
    data: {
      name: trimmed,
      // Cycle the NEON accents so neighbouring column groups never share one.
      color: EMPLOYEE_COLORS[count % EMPLOYEE_COLORS.length],
      order: count,
    },
  });

  refresh();
}

export async function updateEmployee(id: string, name: string, role: string) {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A name is required.");

  await prisma.employee.update({
    where: { id },
    data: { name: trimmed, role: role.trim() || null },
  });

  refresh();
}

export async function deleteEmployee(id: string) {
  await requireAdmin();
  // The relation is onDelete: SetNull, so this person's steps survive as
  // unassigned work instead of vanishing from every project at once.
  await prisma.employee.delete({ where: { id } });
  refresh();
}

export async function moveEmployee(id: string, direction: "left" | "right") {
  await requireAdmin();
  const employees = await prisma.employee.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  const index = employees.findIndex((e) => e.id === id);
  const target = index + (direction === "left" ? -1 : 1);
  if (index < 0 || target < 0 || target >= employees.length) return;

  const reordered = [...employees];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

  await prisma.$transaction(
    reordered.map((e, order) => prisma.employee.update({ where: { id: e.id }, data: { order } }))
  );

  refresh();
}

export async function createProcessTask(name: string, employeeId: string | null) {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A step name is required.");

  const count = await prisma.processTask.count();
  await prisma.processTask.create({
    data: { name: trimmed, employeeId: employeeId || null, order: count },
  });

  refresh();
}

export async function updateProcessTask(id: string, name: string, employeeId: string | null) {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A step name is required.");

  await prisma.processTask.update({
    where: { id },
    data: { name: trimmed, employeeId: employeeId || null },
  });

  refresh();
}

export async function deleteProcessTask(id: string) {
  await requireAdmin();
  await prisma.processTask.delete({ where: { id } });
  refresh();
}

// Steps are grouped under their owner on the board, so a move only makes
// visible sense against that owner's own steps — swapping with the global
// neighbour would look like nothing happened whenever it belongs elsewhere.
export async function moveProcessTask(id: string, direction: "left" | "right") {
  await requireAdmin();
  const tasks = await prisma.processTask.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  const task = tasks.find((t) => t.id === id);
  if (!task) return;

  const siblings = tasks.filter((t) => t.employeeId === task.employeeId);
  const index = siblings.findIndex((t) => t.id === id);
  const target = index + (direction === "left" ? -1 : 1);
  if (target < 0 || target >= siblings.length) return;

  // Swap the two steps' positions in the global list, then rewrite every order
  // value — earlier inserts can leave them duplicated or sparse.
  const positions = tasks.map((t) => t.id);
  const a = positions.indexOf(siblings[index].id);
  const b = positions.indexOf(siblings[target].id);
  const reordered = [...tasks];
  [reordered[a], reordered[b]] = [reordered[b], reordered[a]];

  await prisma.$transaction(
    reordered.map((t, order) => prisma.processTask.update({ where: { id: t.id }, data: { order } }))
  );

  refresh();
}
