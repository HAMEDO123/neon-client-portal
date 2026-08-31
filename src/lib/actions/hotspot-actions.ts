"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

function refresh(projectId: string) {
  revalidatePath(`/admin/projects/${projectId}/gallery`);
}

export async function createHotspot(
  projectId: string,
  imageId: string,
  xPercent: number,
  yPercent: number,
  formData: FormData
) {
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return;

  const count = await prisma.imageHotspot.count({ where: { imageId } });
  await prisma.imageHotspot.create({
    data: {
      imageId,
      xPercent,
      yPercent,
      label,
      description: String(formData.get("description") ?? "") || null,
      category: String(formData.get("category") ?? "") || null,
      linkLabel: String(formData.get("linkLabel") ?? "") || null,
      order: count,
    },
  });
  refresh(projectId);
}

export async function deleteHotspot(projectId: string, id: string) {
  await prisma.imageHotspot.delete({ where: { id } });
  refresh(projectId);
}
