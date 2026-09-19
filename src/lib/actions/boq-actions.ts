"use server";

import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/admin-guard";
import { deleteFile, saveFile } from "@/lib/storage";
import { refreshProject } from "@/lib/project-paths";

function refresh(projectId: string) {
  refreshProject(projectId, { tab: "boq" });
}

export async function createBoqItem(projectId: string, formData: FormData) {
  await requireStaff();
  const imageFile = formData.get("image");
  const imageUrl = imageFile instanceof File && imageFile.size > 0 ? (await saveFile(imageFile, `projects/${projectId}/boq`, "image")).url : null;
  const count = await prisma.boqItem.count({ where: { projectId } });

  await prisma.boqItem.create({
    data: {
      projectId,
      category: String(formData.get("category") ?? "Other"),
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? "") || null,
      specification: String(formData.get("specification") ?? "") || null,
      unit: String(formData.get("unit") ?? ""),
      quantity: Number(formData.get("quantity") ?? 0),
      unitPrice: formData.get("unitPrice") ? Number(formData.get("unitPrice")) : null,
      relatedDrawing: String(formData.get("relatedDrawing") ?? "") || null,
      relatedSpace: String(formData.get("relatedSpace") ?? "") || null,
      notes: String(formData.get("notes") ?? "") || null,
      imageUrl,
      order: count,
    },
  });
  refresh(projectId);
}

export async function deleteBoqItem(projectId: string, id: string) {
  await requireStaff();
  const existing = await prisma.boqItem.findUnique({ where: { id } });
  if (existing) await deleteFile(existing.imageUrl);
  await prisma.boqItem.delete({ where: { id } });
  refresh(projectId);
}
