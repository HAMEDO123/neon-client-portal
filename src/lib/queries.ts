import { prisma } from "@/lib/db";

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
