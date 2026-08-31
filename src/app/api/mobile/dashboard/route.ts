import { NextResponse } from "next/server";
import { requireMobileAuth } from "@/lib/mobile-auth";
import { getDashboardStats, getProjects } from "@/lib/queries";

export async function GET(request: Request) {
  if (!requireMobileAuth(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const [stats, projects] = await Promise.all([getDashboardStats(), getProjects()]);

  return NextResponse.json({
    stats,
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      clientName: p.clientName,
      location: p.location,
      publishState: p.publishState,
      pipelineStatus: p.pipelineStatus,
      coverImageUrl: p.coverImageUrl,
      updatedAt: p.updatedAt,
      approvalsCount: p._count.approvals,
      commentsCount: p._count.comments,
    })),
  });
}
