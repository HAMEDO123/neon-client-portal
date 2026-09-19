"use server";

import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/admin-guard";
import { deleteFile, saveFile } from "@/lib/storage";
import { refreshProject } from "@/lib/project-paths";

function refresh(projectId: string) {
  refreshProject(projectId, { tab: "furniture" });
}

export async function createFurnitureItem(projectId: string, formData: FormData) {
  await requireStaff();
  const imageFile = formData.get("image");
  const imageUrl = imageFile instanceof File && imageFile.size > 0 ? (await saveFile(imageFile, `projects/${projectId}/furniture`, "image")).url : null;
  const count = await prisma.furnitureItem.count({ where: { projectId } });

  await prisma.furnitureItem.create({
    data: {
      projectId,
      name: String(formData.get("name") ?? ""),
      brand: String(formData.get("brand") ?? "") || null,
      model: String(formData.get("model") ?? "") || null,
      dimensions: String(formData.get("dimensions") ?? "") || null,
      quantity: Number(formData.get("quantity") ?? 1),
      finish: String(formData.get("finish") ?? "") || null,
      supplier: String(formData.get("supplier") ?? "") || null,
      reference: String(formData.get("reference") ?? "") || null,
      price: formData.get("price") ? Number(formData.get("price")) : null,
      space: String(formData.get("space") ?? "") || null,
      imageUrl,
      order: count,
    },
  });
  refresh(projectId);
}

export async function deleteFurnitureItem(projectId: string, id: string) {
  await requireStaff();
  const existing = await prisma.furnitureItem.findUnique({ where: { id } });
  if (existing) await deleteFile(existing.imageUrl);
  await prisma.furnitureItem.delete({ where: { id } });
  refresh(projectId);
}
