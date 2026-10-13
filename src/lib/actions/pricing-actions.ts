"use server";

import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/admin-guard";
import { refreshProject } from "@/lib/project-paths";
import { createDocument } from "@/lib/actions/document-actions";
import { PRICING_FILE_CATEGORY, pricingFileTitle } from "@/lib/pricing-files";
import { Refusal, answering, type Answer } from "@/lib/refusal";
import { deleteFile } from "@/lib/storage";

function refresh(projectId: string) {
  refreshProject(projectId, { tab: "pricing" });
}

/**
 * Adds the price as a file. It is a document filed under "Pricing"
 * (lib/pricing-files.ts), stored by the Documents tab's own upload, so there
 * is one rule for what a file may be. Answers with its refusal rather than
 * throwing it — "that is not a file we can store" has to reach whoever chose it.
 */
export async function addPricingFile(projectId: string, formData: FormData): Promise<Answer> {
  await requireStaff();

  return answering(async () => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Refusal("Choose the pricing file to add.");

    formData.set("category", PRICING_FILE_CATEGORY);
    formData.set("title", pricingFileTitle(String(formData.get("title") ?? ""), file.name));
    await createDocument(projectId, formData);
    refresh(projectId);
  });
}

/** Removes a pricing file. Scoped to the project and the category, so another id is not found. */
export async function deletePricingFile(projectId: string, id: string) {
  await requireStaff();
  const existing = await prisma.document.findFirst({ where: { id, projectId, category: PRICING_FILE_CATEGORY } });
  if (!existing) return;

  await deleteFile(existing.fileUrl);
  await prisma.document.delete({ where: { id: existing.id } });
  refresh(projectId);
  refreshProject(projectId, { tab: "documents" });
}

export async function createPricingItem(projectId: string, formData: FormData) {
  await requireStaff();
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
  await requireStaff();
  await prisma.pricingItem.delete({ where: { id } });
  refresh(projectId);
}
