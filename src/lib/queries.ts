import { prisma } from "@/lib/db";
import { ownerOf } from "@/lib/stage-deadlines";
import { UNSECTIONED_ID } from "@/lib/task-board";
import type { TaskState } from "@/generated/prisma/enums";

export function getProjects() {
  return prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { comments: true, approvals: true } } },
  });
}

export async function getDashboardStats() {
  const [total, published, pendingApprovals, recentlyUpdated] = await Promise.all([
    prisma.project.count(),
    prisma.project.count({ where: { publishState: "PUBLISHED" } }),
    prisma.approval.count({ where: { status: "PENDING" } }),
    prisma.project.count({
      where: { updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    }),
  ]);
  return { total, published, pendingApprovals, recentlyUpdated };
}

const fullProjectInclude = {
  spaces: {
    orderBy: { order: "asc" as const },
    include: {
      images: {
        orderBy: { order: "asc" as const },
        include: { hotspots: { orderBy: { order: "asc" as const } } },
      },
    },
  },
  drawings: {
    orderBy: [{ category: "asc" as const }, { order: "asc" as const }],
    include: { revisions: { orderBy: { createdAt: "desc" as const } } },
  },
  documents: { orderBy: [{ category: "asc" as const }, { order: "asc" as const }] },
  boqItems: { orderBy: [{ category: "asc" as const }, { order: "asc" as const }] },
  pricingItems: { orderBy: [{ category: "asc" as const }, { order: "asc" as const }] },
  materials: { orderBy: [{ category: "asc" as const }, { order: "asc" as const }] },
  furniture: { orderBy: { order: "asc" as const } },
  approvals: { orderBy: { order: "asc" as const } },
  comments: { orderBy: { createdAt: "desc" as const } },
};

export function getProjectById(id: string) {
  return prisma.project.findUnique({ where: { id }, include: fullProjectInclude });
}

export function getProjectByToken(token: string) {
  return prisma.project.findUnique({ where: { token }, include: fullProjectInclude });
}

export function getRecentActivity(projectId: string, take = 20) {
  return prisma.projectActivity.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function getProjectAnalytics(projectId: string) {
  const [byType, recent, totalEvents] = await Promise.all([
    prisma.projectActivity.groupBy({
      by: ["type"],
      where: { projectId },
      _count: { type: true },
    }),
    prisma.projectActivity.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.projectActivity.count({ where: { projectId } }),
  ]);

  const counts = Object.fromEntries(byType.map((b) => [b.type, b._count.type]));
  return {
    totalEvents,
    views: counts["viewed_project"] ?? 0,
    renderViews: counts["viewed_render"] ?? 0,
    downloads:
      (counts["downloaded_drawing"] ?? 0) +
      (counts["downloaded_document"] ?? 0) +
      (counts["downloaded_image"] ?? 0) +
      (counts["downloaded_package"] ?? 0),
    approvals: (counts["approved"] ?? 0) + (counts["requested_changes"] ?? 0),
    comments: counts["commented"] ?? 0,
    byType,
    recent,
  };
}

export type FullProject = NonNullable<Awaited<ReturnType<typeof getProjectById>>>;

export function getEmployees() {
  return prisma.employee.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { tasks: true } } },
  });
}

export function getProcessTasks() {
  return prisma.processTask.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: { employee: true, section: true },
  });
}

export function getProcessSections() {
  return prisma.processSection.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
}

export function getStagePeriods() {
  return prisma.stagePeriod.findMany({ orderBy: { createdAt: "asc" } });
}

// The daily task board: every project crossed with every step of the shared
// process. Entries are sparse — a cell the team has never touched has no row,
// so the board fills the gaps with TODO rather than pre-creating the matrix.
export async function getTaskBoard() {
  const [projects, employees, tasks, sectionRows, sectionTeam, entries] = await Promise.all([
    prisma.project.findMany({
      where: { publishState: { not: "ARCHIVED" } },
      orderBy: [{ pipelineStatus: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        name: true,
        clientName: true,
        location: true,
        coverImageUrl: true,
        pipelineStatus: true,
      },
    }),
    getEmployees(),
    getProcessTasks(),
    getProcessSections(),
    prisma.projectSectionAssignment.findMany({
      select: { projectId: true, sectionId: true, employeeId: true },
    }),
    prisma.projectTaskEntry.findMany({
      select: {
        id: true,
        projectId: true,
        taskId: true,
        state: true,
        completedAt: true,
        priority: true,
        scheduledFor: true,
        dueAt: true,
        adminNote: true,
        assigneeId: true,
        excludedFromProgress: true,
      },
    }),
  ]);

  // The columns are the process itself, grouped into its sections — Site &
  // Procurement, 3D Visualization, Technical Drawings — never into people.
  // Work is handed out a section at a time, per project, because the same
  // section goes to different people on different jobs.
  const steps = tasks.map((task) => ({
    id: task.id,
    name: task.name,
    sectionId: task.sectionId,
    // The standing owner: who gets a step when nothing else has been said.
    defaultOwnerId: task.employeeId,
  }));

  // Steps with no section of their own still need a home, or they would vanish
  // from a board that groups by section.
  const loose = steps.filter((step) => !step.sectionId);
  const sections = [
    ...sectionRows.map((section) => ({
      id: section.id,
      name: section.name,
      color: section.color,
      real: true,
      steps: steps.filter((step) => step.sectionId === section.id),
    })),
    ...(loose.length > 0
      ? [{ id: UNSECTIONED_ID, name: "Other", color: "neutral", real: false, steps: loose }]
      : []),
  ].filter((section) => section.steps.length > 0 || section.real);

  const teamBy = new Map(
    sectionTeam.map((row) => [`${row.projectId}:${row.sectionId}`, row.employeeId])
  );

  const team = employees
    .filter((employee) => employee.active)
    .map((employee) => ({
      id: employee.id,
      name: employee.name,
      role: employee.role,
      color: employee.color,
    }));

  const entryByCell = new Map(entries.map((e) => [`${e.projectId}:${e.taskId}`, e]));

  const rows = projects.map((project) => {
    const cells = steps.map((step) => {
      const entry = entryByCell.get(`${project.id}:${step.id}`);
      return {
        taskId: step.id,
        state: entry?.state ?? ("TODO" as TaskState),
        // Scheduling detail the admin set on this cell. Absent until someone
        // schedules it — the matrix stays sparse.
        priority: entry?.priority ?? ("MEDIUM" as const),
        scheduledFor: entry?.scheduledFor ? entry.scheduledFor.toISOString().slice(0, 10) : null,
        dueAt: entry?.dueAt ? entry.dueAt.toISOString() : null,
        adminNote: entry?.adminNote ?? null,
        assigneeId: entry?.assigneeId ?? null,
        excludedFromProgress: entry?.excludedFromProgress ?? false,
        // Who is actually on the hook: a person named on the cell, then
        // whoever holds this section of this project, then the standing owner.
        ownerId: ownerOf(
          entry?.assigneeId ?? null,
          { employeeId: step.defaultOwnerId },
          step.sectionId ? teamBy.get(`${project.id}:${step.sectionId}`) : null
        ),
      };
    });
    // Excluded cells are still on the board; they are just not part of anyone's
    // score, so the row's own tally leaves them out too.
    const counted = cells.filter((c) => !c.excludedFromProgress);
    return {
      project,
      cells,
      done: counted.filter((c) => c.state === "DONE").length,
      tomorrow: counted.filter((c) => c.state === "TOMORROW").length,
    };
  });

  return {
    steps,
    sections,
    // Who holds each section of each project, for the row's assign popup.
    sectionTeam: Object.fromEntries(teamBy),
    team,
    rows,
    totalTasks: steps.length,
    hasEmployees: team.length > 0,
    doneCount: rows.reduce((sum, r) => sum + r.done, 0),
    tomorrowCount: rows.reduce((sum, r) => sum + r.tomorrow, 0),
  };
}

export type TaskBoard = Awaited<ReturnType<typeof getTaskBoard>>;
export type TaskBoardStep = TaskBoard["steps"][number];
export type TaskBoardSection = TaskBoard["sections"][number];
export type TaskBoardMember = TaskBoard["team"][number];
export type TaskBoardRow = TaskBoard["rows"][number];
export type TaskBoardCell = TaskBoardRow["cells"][number];
