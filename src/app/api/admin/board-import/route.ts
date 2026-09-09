// One-off import for moving a task board built on a dev machine into this
// deployment. Additive and idempotent: it matches people, steps and ticks by
// name and never deletes anything, so re-running it is safe.
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { EMPLOYEE_COLORS } from "@/lib/task-board";
import type { TaskState } from "@/generated/prisma/enums";

type IncomingTask = { name: string; order?: number };
type IncomingEmployee = { name: string; role?: string | null; color?: string; order?: number; tasks?: IncomingTask[] };
type IncomingEntry = { project: string; task: string; state: string };

const STATES: TaskState[] = ["TODO", "DONE", "TOMORROW"];

function cleanName(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

export async function POST(request: Request) {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    employees?: IncomingEmployee[];
    unassignedTasks?: IncomingTask[];
    entries?: IncomingEntry[];
  } | null;

  if (!body || !Array.isArray(body.employees)) {
    return Response.json({ error: "Expected { employees: [...] }" }, { status: 400 });
  }

  const summary = { peopleCreated: 0, peopleMatched: 0, stepsCreated: 0, stepsMatched: 0, ticks: 0, skipped: [] as string[] };
  let order = await prisma.processTask.count();

  async function importTask(name: string, employeeId: string | null) {
    const existing = await prisma.processTask.findFirst({ where: { name, employeeId } });
    if (existing) {
      summary.stepsMatched++;
      return existing;
    }
    summary.stepsCreated++;
    return prisma.processTask.create({ data: { name, employeeId, order: order++ } });
  }

  for (const [index, person] of body.employees.entries()) {
    const name = cleanName(person?.name);
    if (!name) {
      summary.skipped.push(`employee #${index + 1} (no name)`);
      continue;
    }

    let employee = await prisma.employee.findFirst({ where: { name } });
    if (employee) {
      summary.peopleMatched++;
    } else {
      const color = EMPLOYEE_COLORS.includes(person.color as (typeof EMPLOYEE_COLORS)[number])
        ? (person.color as string)
        : EMPLOYEE_COLORS[(await prisma.employee.count()) % EMPLOYEE_COLORS.length];
      employee = await prisma.employee.create({
        data: {
          name,
          role: cleanName(person?.role) || null,
          color,
          order: typeof person.order === "number" ? person.order : index,
        },
      });
      summary.peopleCreated++;
    }

    for (const task of person.tasks ?? []) {
      const taskName = cleanName(task?.name);
      if (taskName) await importTask(taskName, employee.id);
    }
  }

  for (const task of body.unassignedTasks ?? []) {
    const taskName = cleanName(task?.name);
    if (taskName) await importTask(taskName, null);
  }

  for (const entry of body.entries ?? []) {
    const projectName = cleanName(entry?.project);
    const taskName = cleanName(entry?.task);
    const state = STATES.includes(entry?.state as TaskState) ? (entry.state as TaskState) : null;
    if (!projectName || !taskName || !state) continue;

    const project = await prisma.project.findFirst({ where: { name: projectName } });
    const task = await prisma.processTask.findFirst({ where: { name: taskName } });
    if (!project || !task) {
      // A tick for a project this deployment does not have is expected —
      // report it rather than failing the whole import.
      summary.skipped.push(`tick "${taskName}" on "${projectName}"`);
      continue;
    }

    await prisma.projectTaskEntry.upsert({
      where: { projectId_taskId: { projectId: project.id, taskId: task.id } },
      create: { projectId: project.id, taskId: task.id, state, completedAt: state === "DONE" ? new Date() : null },
      update: { state, completedAt: state === "DONE" ? new Date() : null },
    });
    summary.ticks++;
  }

  return Response.json(summary);
}
