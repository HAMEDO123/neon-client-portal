"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { deleteFile, saveFile } from "@/lib/storage";

function refresh(projectId: string) {
  revalidatePath(`/admin/projects/${projectId}/documents`);
}

export async function createDocument(projectId: string, formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Select a file to upload.");

  const saved = await saveFile(file, `projects/${projectId}/documents`, "document");
  const count = await prisma.document.count({ where: { projectId } });

  await prisma.document.create({
    data: {
      projectId,
      category: String(formData.get("category") ?? "Other"),
      title: String(formData.get("title") ?? "Untitled Document"),
      version: String(formData.get("version") ?? "") || null,
      fileUrl: saved.url,
      fileType: saved.fileType,
      fileSize: saved.fileSize,
      order: count,
    },
  });
  refresh(projectId);
}

export async function deleteDocument(projectId: string, id: string) {
  const existing = await prisma.document.findUnique({ where: { id } });
  if (existing) await deleteFile(existing.fileUrl);
  await prisma.document.delete({ where: { id } });
  refresh(projectId);
}
