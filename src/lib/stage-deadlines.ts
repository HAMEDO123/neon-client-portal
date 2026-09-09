import { prisma } from "@/lib/db";
import { planStages, type PeriodInput, type StageInput, type StagePlan } from "@/lib/stage-schedule";
import type { TaskState } from "@/generated/prisma/enums";

// Turning the stage periods into real dates for real projects.
//
// A board cell has no row until somebody touches it, so a project's chain has
// gaps in it. Planning still walks every step in order — an untouched step in
// the middle still sits inside its range, and a step nobody has started is
// exactly the one worth chasing — so cells without a row take part under a
// synthetic key and simply have no id of their own yet.

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
  /** Who is on the hook: this project's section team, else the step's standing owner. */
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
    select: { id: true, name: true, order: true, employeeId: true, sectionId: true },
  });
  if (tasks.length === 0) return plan;

  const periodRows = await prisma.stagePeriod.findMany({
    orderBy: { createdAt: "asc" },
    select: { fromTaskId: true, toTaskId: true, days: true },
  });
  const periods: PeriodInput[] = periodRows;

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

  // Who holds each section on each project — the assignment the manager makes
  // from the project's own row.
  const sectionTeam = await prisma.projectSectionAssignment.findMany({
    where: { projectId: { in: projectIds } },
    select: { projectId: true, sectionId: true, employeeId: true },
  });

  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, name: true, createdAt: true },
  });

  const entryBy = new Map(entries.map((entry) => [cellKey(entry.projectId, entry.taskId), entry]));
  const teamBy = new Map(
    sectionTeam.map((row) => [`${row.projectId}:${row.sectionId}`, row.employeeId])
  );

  for (const project of projects) {
    const stages: StageInput[] = tasks.map((task) => {
      const entry = entryBy.get(cellKey(project.id, task.id));
      return {
        entryId: entry?.id ?? cellKey(project.id, task.id),
        taskId: task.id,
        order: task.order,
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

    const planned = planStages(stages, periods, anchor);

    // planStages sorts by order, and `tasks` is already in that order, so the
    // two line up.
    for (const [index, task] of tasks.entries()) {
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
        ownerId: ownerOf(entry?.assigneeId ?? null, task, teamBy.get(`${project.id}:${task.sectionId}`)),
      });
    }
  }

  return plan;
}

/**
 * Who a cell belongs to, in the order the platform decides it: a person named
 * on the cell itself, then whoever holds that section of this project, then the
 * step's standing owner.
 */
export function ownerOf(
  assigneeId: string | null,
  task: { employeeId: string | null },
  sectionOwnerId: string | null | undefined
) {
  return assigneeId ?? sectionOwnerId ?? task.employeeId ?? null;
}

/** The plan for one set of tasks the employee portal is already holding. */
export async function planForTasks(tasks: { id: string; project: { id: string } }[]) {
  const projectIds = [...new Set(tasks.map((task) => task.project.id))];
  return planForProjects(projectIds);
}
