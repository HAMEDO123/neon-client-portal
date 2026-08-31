"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { deleteFile, saveFile } from "@/lib/storage";

function refresh(projectId: string) {
  revalidatePath(`/admin/projects/${projectId}/drawings`);
}

export async function createDrawing(projectId: string, formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Select a file to upload.");

  const saved = await saveFile(file, `projects/${projectId}/drawings`, "document");
  const count = await prisma.drawing.count({ where: { projectId } });

  await prisma.drawing.create({
    data: {
      projectId,
      category: String(formData.get("category") ?? "Architectural"),
      subCategory: String(formData.get("subCategory") ?? "") || null,
      name: String(formData.get("name") ?? "Untitled Drawing"),
      drawingNumber: String(formData.get("drawingNumber") ?? "") || null,
      revision: String(formData.get("revision") ?? "R00"),
      fileUrl: saved.url,
      fileType: saved.fileType,
      fileSize: saved.fileSize,
      order: count,
    },
  });
  refresh(projectId);
}

// Uploading a new revision archives the current file into DrawingRevision history,
// then promotes the new upload to be the drawing's current file/revision.
export async function addDrawingRevision(projectId: string, drawingId: string, formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Select a file to upload.");

  const existing = await prisma.drawing.findUniqueOrThrow({ where: { id: drawingId } });
  const revision = String(formData.get("revision") ?? "").trim();
  if (!revision) throw new Error("Revision label is required.");

  const saved = await saveFile(file, `projects/${projectId}/drawings`, "document");

  const note = String(formData.get("note") ?? "").trim() || null;

  await prisma.$transaction([
    prisma.drawingRevision.create({
      data: { drawingId, revision: existing.revision, fileUrl: existing.fileUrl, note },
    }),
    prisma.drawing.update({
      where: { id: drawingId },
      data: { revision, fileUrl: saved.url, fileType: saved.fileType, fileSize: saved.fileSize },
    }),
  ]);
  refresh(projectId);
}

export async function deleteRevision(projectId: string, id: string) {
  const existing = await prisma.drawingRevision.findUnique({ where: { id } });
  if (existing) await deleteFile(existing.fileUrl);
  await prisma.drawingRevision.delete({ where: { id } });
  refresh(projectId);
}

export async function deleteDrawing(projectId: string, id: string) {
  const existing = await prisma.drawing.findUnique({ where: { id } });
  if (existing) await deleteFile(existing.fileUrl);
  await prisma.drawing.delete({ where: { id } });
  refresh(projectId);
}
