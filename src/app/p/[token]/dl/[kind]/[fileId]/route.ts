import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";

export async function GET(request: Request, context: { params: Promise<{ token: string; kind: string; fileId: string }> }) {
  const { token, kind, fileId } = await context.params;

  const project = await prisma.project.findUnique({ where: { token } });
  if (!project || project.publishState !== "PUBLISHED" || !project.allowDownloads) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  let fileUrl: string | null = null;
  let label: string | null = null;

  if (kind === "drawing") {
    const drawing = await prisma.drawing.findFirst({ where: { id: fileId, projectId: project.id } });
    fileUrl = drawing?.fileUrl ?? null;
    label = drawing?.name ?? null;
  } else if (kind === "document") {
    const doc = await prisma.document.findFirst({ where: { id: fileId, projectId: project.id } });
    fileUrl = doc?.fileUrl ?? null;
    label = doc?.title ?? null;
  } else if (kind === "image") {
    const image = await prisma.galleryImage.findFirst({ where: { id: fileId, space: { projectId: project.id } } });
    fileUrl = image?.imageUrl ?? null;
    label = image?.caption ?? null;
  } else {
    return NextResponse.json({ error: "Unknown file type." }, { status: 400 });
  }

  if (!fileUrl) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  await logActivity(
    project.id,
    kind === "drawing" ? "downloaded_drawing" : kind === "document" ? "downloaded_document" : "downloaded_image",
    label ?? undefined
  );

  const destination = fileUrl.startsWith("/") ? new URL(fileUrl, request.url) : fileUrl;
  return NextResponse.redirect(destination);
}
