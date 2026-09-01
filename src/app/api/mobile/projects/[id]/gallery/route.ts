import { NextResponse } from "next/server";
import { requireMobileAuth } from "@/lib/mobile-auth";
import { prisma } from "@/lib/db";
import { saveFile } from "@/lib/storage";

// Multipart upload from the app: one or more `image` files, plus either an
// existing `spaceId` or a `spaceName` to create/reuse, and an optional caption.
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

  const formData = await request.formData();
  const files = formData.getAll("image").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return NextResponse.json({ error: "Select at least one image." }, { status: 400 });
  }

  const caption = String(formData.get("caption") ?? "").trim() || null;
  let spaceId = String(formData.get("spaceId") ?? "").trim();
  const spaceName = String(formData.get("spaceName") ?? "").trim();

  if (!spaceId) {
    if (!spaceName) {
      return NextResponse.json({ error: "spaceId or spaceName is required." }, { status: 400 });
    }
    const existing = await prisma.gallerySpace.findFirst({
      where: { projectId: id, name: { equals: spaceName, mode: "insensitive" } },
    });
    if (existing) {
      spaceId = existing.id;
    } else {
      const count = await prisma.gallerySpace.count({ where: { projectId: id } });
      const created = await prisma.gallerySpace.create({
        data: { projectId: id, name: spaceName, order: count },
      });
      spaceId = created.id;
    }
  } else {
    const space = await prisma.gallerySpace.findFirst({ where: { id: spaceId, projectId: id } });
    if (!space) {
      return NextResponse.json({ error: "Space not found." }, { status: 404 });
    }
  }

  let order = await prisma.galleryImage.count({ where: { spaceId } });
  const uploaded = [];
  for (const file of files) {
    const saved = await saveFile(file, `projects/${id}/gallery`, "image", true);
    const image = await prisma.galleryImage.create({
      data: { spaceId, imageUrl: saved.url, caption, order },
    });
    uploaded.push({ id: image.id, imageUrl: image.imageUrl, caption: image.caption });
    order += 1;
  }

  return NextResponse.json({ spaceId, uploaded });
}
