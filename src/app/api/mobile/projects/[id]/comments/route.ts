import { NextResponse } from "next/server";
import { requireMobileAuth } from "@/lib/mobile-auth";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!requireMobileAuth(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const refLabel =
    typeof body?.refLabel === "string" && body.refLabel.trim() ? body.refLabel.trim() : null;
  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  const comment = await prisma.comment.create({
    data: { projectId: id, authorName: "NEON Team", message, refLabel, authorType: "ADMIN" },
  });
  await logActivity(id, "commented", refLabel ?? undefined);

  return NextResponse.json({
    id: comment.id,
    authorName: comment.authorName,
    authorType: comment.authorType,
    message: comment.message,
    refLabel: comment.refLabel,
    status: comment.status,
    createdAt: comment.createdAt,
  });
}
