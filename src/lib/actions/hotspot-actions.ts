"use server";

import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/admin-guard";
import { refreshProject } from "@/lib/project-paths";

// Hotspots are drawn on a gallery image, so the gallery is the screen that
// changes when one is added or removed.
function refresh(projectId: string) {
  refreshProject(projectId, { tab: "gallery" });
}

export async function createHotspot(
  projectId: string,
  imageId: string,
  xPercent: number,
  yPercent: number,
  formData: FormData
) {
  await requireStaff();
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
  await requireStaff();
  await prisma.imageHotspot.delete({ where: { id } });
  refresh(projectId);
}
