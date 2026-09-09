import { prisma } from "@/lib/db";
import { planStages, type StageInput, type StagePlan } from "@/lib/stage-schedule";

// Turning the stage lengths into real dates for real projects.
//
// A board cell has no row until somebody touches it, so a project's chain has
// gaps in it. Planning still has to walk every stage in order — an untouched
// step in the middle still consumes its days — so cells without a row take part
// under a synthetic key and simply have no dates of their own yet.

export function cellKey(projectId: string, taskId: string) {
  return `${projectId}:${taskId}`;
}

export type ProjectPlan = Map<string, StagePlan>;

/**
 * Deadlines for every stage of the given projects, keyed by entry id and also
 * by "projectId:taskId" so an untouched cell can be looked up too.
 */
export async function planForProjects(projectIds: string[]): Promise<ProjectPlan> {
  const plan: ProjectPlan = new Map();
  if (projectIds.length === 0) return plan;

  // Sequential, like the other multi-query reads in this codebase.
  const tasks = await prisma.processTask.findMany({
    orderBy: { order: "asc" },
    select: { id: true, order: true, durationDays: true },
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
    },
  });

  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, createdAt: true },
  });

  const entryBy = new Map(entries.map((entry) => [cellKey(entry.projectId, entry.taskId), entry]));

  for (const project of projects) {
    const stages: StageInput[] = tasks.map((task) => {
      const key = cellKey(project.id, task.id);
      const entry = entryBy.get(key);
      return {
        entryId: entry?.id ?? key,
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

    // The key is the entry id where there is one and the cell key where there
    // is not, so both callers find what they are looking for.
    for (const stagePlan of planStages(stages, anchor)) {
      plan.set(stagePlan.entryId, stagePlan);
    }
  }

  return plan;
}

/** The plan for one set of tasks the employee portal is already holding. */
export async function planForTasks(tasks: { id: string; project: { id: string } }[]) {
  const projectIds = [...new Set(tasks.map((task) => task.project.id))];
  return planForProjects(projectIds);
}
