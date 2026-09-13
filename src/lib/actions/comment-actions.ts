"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-guard";
import { logActivity } from "@/lib/activity";

// Two audiences in one file, so each half says which it is. Adding an action
// here means deciding which side it belongs to first.

// ---------- Client (access is gated by possession of the project link, not a login) ----------
//
// Deliberately unguarded: a client has no login, and the link is the credential.
// The project is found by its token, so a comment can only ever be written
// against the project whose link was used.

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

// ---------- Admin ----------

export async function resolveComment(projectId: string, id: string, status: "OPEN" | "RESOLVED") {
  await requireAdmin();
  await prisma.comment.update({ where: { id }, data: { status } });
  revalidatePath(`/admin/projects/${projectId}/comments`);
}

export async function deleteComment(projectId: string, id: string) {
  await requireAdmin();
  await prisma.comment.delete({ where: { id } });
  revalidatePath(`/admin/projects/${projectId}/comments`);
}
