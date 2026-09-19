"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/admin-guard";
import { refreshProject } from "@/lib/project-paths";
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

// ---------- The studio ----------
//
// `requireStaff`, not `requireAdmin`: the team works a project the same way the
// manager does. Everything above this line stays open, because the client has
// no session to check.

export async function resolveComment(projectId: string, id: string, status: "OPEN" | "RESOLVED") {
  await requireStaff();
  await prisma.comment.update({ where: { id }, data: { status } });
  refreshProject(projectId, { tab: "comments" });
}

export async function deleteComment(projectId: string, id: string) {
  await requireStaff();
  await prisma.comment.delete({ where: { id } });
  refreshProject(projectId, { tab: "comments" });
}
