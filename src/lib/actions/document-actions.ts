"use server";

import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/admin-guard";
import { deleteFile, saveFile } from "@/lib/storage";
import { refreshProject } from "@/lib/project-paths";

function refresh(projectId: string) {
  refreshProject(projectId, { tab: "documents" });
}

export async function createDocument(projectId: string, formData: FormData) {
  await requireStaff();
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
  await requireStaff();
  const existing = await prisma.document.findUnique({ where: { id } });
  if (existing) await deleteFile(existing.fileUrl);
  await prisma.document.delete({ where: { id } });
  refresh(projectId);
}
