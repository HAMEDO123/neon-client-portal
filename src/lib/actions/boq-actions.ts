"use server";

import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/admin-guard";
import { deleteFile, saveFile } from "@/lib/storage";
import { refreshProject } from "@/lib/project-paths";
import { createDocument } from "@/lib/actions/document-actions";
import { BOQ_FILE_CATEGORY, boqFileTitle } from "@/lib/boq-files";
import { answering, Refusal, type Answer } from "@/lib/refusal";

function refresh(projectId: string) {
  refreshProject(projectId, { tab: "boq" });
}

/**
 * Adds a BOQ that already exists as a file — a spreadsheet, a PDF.
 *
 * It is filed as a Document under "BOQ" (lib/boq-files.ts says why that and
 * not a table of its own), so this is the Documents tab's own upload with the
 * category decided and the title optional: a BOQ file is usually already
 * called what it is.
 *
 * It answers with its refusal rather than throwing it (lib/refusal.ts) —
 * "that is not a file we can store" has to reach whoever chose the file.
 */
export async function addBoqFile(projectId: string, formData: FormData): Promise<Answer> {
  await requireStaff();

  return answering(async () => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Refusal("Choose the BOQ file to add.");

    formData.set("category", BOQ_FILE_CATEGORY);
    formData.set("title", boqFileTitle(String(formData.get("title") ?? ""), file.name));
    await createDocument(projectId, formData);
    refresh(projectId);
  });
}

/**
 * Removes a BOQ file. Scoped to the project and to BOQ files in the `where`,
 * so an id from somewhere else is not found rather than deleted.
 */
export async function deleteBoqFile(projectId: string, id: string) {
  await requireStaff();
  const existing = await prisma.document.findFirst({ where: { id, projectId, category: BOQ_FILE_CATEGORY } });
  if (!existing) return;

  await deleteFile(existing.fileUrl);
  await prisma.document.delete({ where: { id: existing.id } });
  refresh(projectId);
  refreshProject(projectId, { tab: "documents" });
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
