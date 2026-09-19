"use server";

import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/admin-guard";
import { deleteFile, saveFile } from "@/lib/storage";
import { refreshProject } from "@/lib/project-paths";

function refresh(projectId: string) {
  refreshProject(projectId, { tab: "materials" });
}

export async function createMaterial(projectId: string, formData: FormData) {
  await requireStaff();
  const imageFile = formData.get("image");
  const imageUrl = imageFile instanceof File && imageFile.size > 0 ? (await saveFile(imageFile, `projects/${projectId}/materials`, "image")).url : null;
  const count = await prisma.material.count({ where: { projectId } });

  await prisma.material.create({
    data: {
      projectId,
      category: String(formData.get("category") ?? "Other"),
      name: String(formData.get("name") ?? ""),
      brand: String(formData.get("brand") ?? "") || null,
      model: String(formData.get("model") ?? "") || null,
      color: String(formData.get("color") ?? "") || null,
      finish: String(formData.get("finish") ?? "") || null,
      specification: String(formData.get("specification") ?? "") || null,
      supplier: String(formData.get("supplier") ?? "") || null,
      reference: String(formData.get("reference") ?? "") || null,
      estimatedQty: String(formData.get("estimatedQty") ?? "") || null,
      price: formData.get("price") ? Number(formData.get("price")) : null,
      relatedSpaces: String(formData.get("relatedSpaces") ?? "") || null,
      imageUrl,
      order: count,
    },
  });
  refresh(projectId);
}

export async function deleteMaterial(projectId: string, id: string) {
  await requireStaff();
  const existing = await prisma.material.findUnique({ where: { id } });
  if (existing) await deleteFile(existing.imageUrl);
  await prisma.material.delete({ where: { id } });
  refresh(projectId);
}
