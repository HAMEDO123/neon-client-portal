"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

function refresh(projectId: string) {
  revalidatePath(`/admin/projects/${projectId}/pricing`);
}

export async function createPricingItem(projectId: string, formData: FormData) {
  const count = await prisma.pricingItem.count({ where: { projectId } });
  await prisma.pricingItem.create({
    data: {
      projectId,
      category: String(formData.get("category") ?? "Other"),
      label: String(formData.get("label") ?? ""),
      description: String(formData.get("description") ?? "") || null,
      amount: Number(formData.get("amount") ?? 0),
      isOptional: formData.get("isOptional") === "on",
      order: count,
    },
  });
  refresh(projectId);
}

export async function deletePricingItem(projectId: string, id: string) {
  await prisma.pricingItem.delete({ where: { id } });
  refresh(projectId);
}
