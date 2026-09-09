import { prisma } from "@/lib/db";
import { planStages, type StageInput, type StagePlan } from "@/lib/stage-schedule";
import type { TaskState } from "@/generated/prisma/enums";

// Turning the stage lengths into real dates for real projects.
//
// A board cell has no row until somebody touches it, so a project's chain has
// gaps in it. Planning still walks every stage in order — an untouched step in
// the middle still consumes its days, and a step nobody has started is exactly
// the one worth chasing — so cells without a row take part under a synthetic
// key and simply have no id of their own yet.

export function cellKey(projectId: string, taskId: string) {
  return `${projectId}:${taskId}`;
}

// entryId is deliberately re-declared: a plan covers cells that have no row.
export type PlannedStage = Omit<StagePlan, "entryId"> & {
  projectId: string;
  taskId: string;
  taskName: string;
  projectName: string;
  /** Null while the cell has no row on the board. */
  entryId: string | null;
  state: TaskState;
  excludedFromProgress: boolean;
  /** Who is on the hook: this project's choice, else the step's standing owner. */
  ownerId: string | null;
};

/**
 * Deadlines for every stage of the given projects, keyed by entry id where the
 * cell has a row and by "projectId:taskId" where it does not — so a caller
 * holding either can look one up, and iterating the values covers the lot.
 */
export type ProjectPlan = Map<string, PlannedStage>;

export async function planForProjects(projectIds: string[]): Promise<ProjectPlan> {
  const plan: ProjectPlan = new Map();
  if (projectIds.length === 0) return plan;

  // Sequential, like the other multi-query reads in this codebase.
  const tasks = await prisma.processTask.findMany({
    orderBy: { order: "asc" },
    select: { id: true, name: true, order: true, durationDays: true, employeeId: true },
  });
  if (tasks.length === 0) return plan;

  const entries = await prisma.projectTaskEntry.findMany({
    where: { projectId: { in: projectIds } },
    select: {
      id: true,
      projectId: true,
      taskId: true,
      state: true,
      startedAt: true,
      completedAt: true,
      scheduledFor: true,
      dueAt: true,
      assigneeId: true,
      excludedFromProgress: true,
    },
  });

  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, name: true, createdAt: true },
  });

  const entryBy = new Map(entries.map((entry) => [cellKey(entry.projectId, entry.taskId), entry]));

  for (const project of projects) {
    const stages: StageInput[] = tasks.map((task) => {
      const entry = entryBy.get(cellKey(project.id, task.id));
      return {
        entryId: entry?.id ?? cellKey(project.id, task.id),
        order: task.order,
        durationDays: task.durationDays,
        state: entry?.state ?? "TODO",
        startedAt: entry?.startedAt ?? null,
        completedAt: entry?.completedAt ?? null,
        scheduledFor: entry?.scheduledFor ?? null,
        dueAt: entry?.dueAt ?? null,
      };
    });

    // Work begins on the earliest day anyone put in the calendar for it, and
    // failing that on the day the project was created.
    const scheduled = stages
      .map((stage) => stage.scheduledFor)
      .filter((date): date is Date => date != null)
      .sort((a, b) => a.getTime() - b.getTime());
    const anchor = scheduled[0] ?? project.createdAt;

    const planned = planStages(stages, anchor);

    for (const [index, task] of tasks.entries()) {
      // planStages sorts by order, and `tasks` is already in that order, so the
      // two line up.
      const stagePlan = planned[index];
      const entry = entryBy.get(cellKey(project.id, task.id));

      plan.set(stagePlan.entryId, {
        ...stagePlan,
        projectId: project.id,
        projectName: project.name,
        taskId: task.id,
        taskName: task.name,
        entryId: entry?.id ?? null,
        state: entry?.state ?? "TODO",
        excludedFromProgress: entry?.excludedFromProgress ?? false,
        ownerId: entry?.assigneeId ?? task.employeeId ?? null,
      });
    }
  }

  return plan;
}

/** The plan for one set of tasks the employee portal is already holding. */
export async function planForTasks(tasks: { id: string; project: { id: string } }[]) {
  const projectIds = [...new Set(tasks.map((task) => task.project.id))];
  return planForProjects(projectIds);
}
