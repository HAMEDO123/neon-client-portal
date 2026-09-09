import { prisma } from "@/lib/db";
import { UNASSIGNED_ID } from "@/lib/task-board";
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
    include: { employee: true },
  });
}

// The daily task board: every project crossed with every step of the shared
// process. Entries are sparse — a cell the team has never touched has no row,
// so the board fills the gaps with TODO rather than pre-creating the matrix.
export async function getTaskBoard() {
  const [projects, employees, tasks, entries] = await Promise.all([
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
    prisma.projectTaskEntry.findMany({
      select: { projectId: true, taskId: true, state: true, completedAt: true },
    }),
  ]);

  // Columns are grouped by employee so each person owns a contiguous block of
  // the header, with anything unassigned collected at the far right. A person
  // with no steps yet keeps an empty group — that is where you add their first.
  const groups = employees
    .filter((e) => e.active)
    .map((e) => ({
      id: e.id,
      name: e.name,
      role: e.role,
      color: e.color,
      editable: true,
      tasks: tasks.filter((t) => t.employeeId === e.id).map((t) => ({ id: t.id, name: t.name })),
    }));

  const unassigned = tasks
    .filter((t) => !t.employeeId || !groups.some((g) => g.id === t.employeeId))
    .map((t) => ({ id: t.id, name: t.name }));
  if (unassigned.length > 0) {
    groups.push({
      id: UNASSIGNED_ID,
      name: "Unassigned",
      role: null,
      color: "neutral",
      editable: false,
      tasks: unassigned,
    });
  }

  const stateByCell = new Map(entries.map((e) => [`${e.projectId}:${e.taskId}`, e.state]));
  const orderedTasks = groups.flatMap((g) => g.tasks);

  const rows = projects.map((project) => {
    const cells = orderedTasks.map((task) => ({
      taskId: task.id,
      state: stateByCell.get(`${project.id}:${task.id}`) ?? ("TODO" as TaskState),
    }));
    return {
      project,
      cells,
      done: cells.filter((c) => c.state === "DONE").length,
      tomorrow: cells.filter((c) => c.state === "TOMORROW").length,
    };
  });

  return {
    groups,
    rows,
    totalTasks: orderedTasks.length,
    hasEmployees: employees.length > 0,
    doneCount: rows.reduce((sum, r) => sum + r.done, 0),
    tomorrowCount: rows.reduce((sum, r) => sum + r.tomorrow, 0),
  };
}

export type TaskBoard = Awaited<ReturnType<typeof getTaskBoard>>;
export type TaskBoardGroup = TaskBoard["groups"][number];
export type TaskBoardRow = TaskBoard["rows"][number];
