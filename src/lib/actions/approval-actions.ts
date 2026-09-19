"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/admin-guard";
import { refreshProject } from "@/lib/project-paths";
import { logActivity } from "@/lib/activity";

// Two audiences in one file, which is why each half says which it is.
//
// The studio's half checks the session, like every other action in the
// platform — `requireStaff` now rather than `requireAdmin`, because the team
// works a project the same way the manager does. The client's does not and
// must not: a client has no login, and the project link is the credential — so
// it is scoped by the token instead, and a token that does not match the
// approval finds nothing.

// ---------- The studio ----------

export async function createApproval(projectId: string, formData: FormData) {
  await requireStaff();
  const itemLabel = String(formData.get("itemLabel") ?? "").trim();
  if (!itemLabel) return;
  const count = await prisma.approval.count({ where: { projectId } });
  await prisma.approval.create({ data: { projectId, itemLabel, order: count } });
  refreshProject(projectId, { tab: "approvals" });
}

export async function deleteApproval(projectId: string, id: string) {
  await requireStaff();
  await prisma.approval.delete({ where: { id } });
  refreshProject(projectId, { tab: "approvals" });
}

// ---------- Client (access is gated by possession of the project link, not a login) ----------
//
// Deliberately unguarded, and safe because of the `where` rather than in spite
// of it: the approval is looked up by id *and* token together, so a guessed id
// without the matching link is simply not found.

export async function respondToApproval(
  token: string,
  approvalId: string,
  status: "APPROVED" | "CHANGES_REQUESTED",
  formData: FormData
) {
  const approval = await prisma.approval.findFirst({ where: { id: approvalId, project: { token } } });
  if (!approval) throw new Error("Not found.");

  const clientName = String(formData.get("clientName") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;

  await prisma.approval.update({
    where: { id: approvalId },
    data: { status, clientName: clientName || approval.clientName, note, respondedAt: new Date() },
  });

  await logActivity(
    approval.projectId,
    status === "APPROVED" ? "approved" : "requested_changes",
    approval.itemLabel
  );

  revalidatePath(`/p/${token}`);
}
