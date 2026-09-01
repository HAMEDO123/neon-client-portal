import { NextResponse } from "next/server";
import { requireMobileAuth } from "@/lib/mobile-auth";
import { prisma } from "@/lib/db";
import { deleteFile, saveFile } from "@/lib/storage";

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
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Select an image." }, { status: 400 });
  }

  const saved = await saveFile(file, `projects/${id}/cover`, "image", true);
  await deleteFile(project.coverImageUrl);
  const updated = await prisma.project.update({
    where: { id },
    data: { coverImageUrl: saved.url },
  });

  return NextResponse.json({ coverImageUrl: updated.coverImageUrl });
}
