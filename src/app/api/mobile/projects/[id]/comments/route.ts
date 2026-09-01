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

// Resolve or reopen a comment thread from the app.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!requireMobileAuth(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const commentId = typeof body?.commentId === "string" ? body.commentId : "";
  const status = body?.status === "RESOLVED" || body?.status === "OPEN" ? body.status : null;
  if (!commentId || !status) {
    return NextResponse.json({ error: "commentId and status (OPEN|RESOLVED) are required." }, { status: 400 });
  }

  const comment = await prisma.comment.findFirst({ where: { id: commentId, projectId: id } });
  if (!comment) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const updated = await prisma.comment.update({ where: { id: commentId }, data: { status } });
  return NextResponse.json({ id: updated.id, status: updated.status });
}
