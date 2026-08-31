"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";

export async function createComment(token: string, formData: FormData) {
  const project = await prisma.project.findUnique({ where: { token } });
  if (!project) throw new Error("Not found.");

  const authorName = String(formData.get("authorName") ?? "").trim() || project.clientName;
  const message = String(formData.get("message") ?? "").trim();
  const refLabel = String(formData.get("refLabel") ?? "").trim() || null;
  if (!message) return;

  await prisma.comment.create({
    data: { projectId: project.id, authorName, message, refLabel, authorType: "CLIENT" },
  });
  await logActivity(project.id, "commented", refLabel ?? undefined);
  revalidatePath(`/p/${token}`);
}

export async function resolveComment(projectId: string, id: string, status: "OPEN" | "RESOLVED") {
  await prisma.comment.update({ where: { id }, data: { status } });
  revalidatePath(`/admin/projects/${projectId}/comments`);
}

export async function deleteComment(projectId: string, id: string) {
  await prisma.comment.delete({ where: { id } });
  revalidatePath(`/admin/projects/${projectId}/comments`);
}
