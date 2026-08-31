"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";

// ---------- Admin ----------

export async function createApproval(projectId: string, formData: FormData) {
  const itemLabel = String(formData.get("itemLabel") ?? "").trim();
  if (!itemLabel) return;
  const count = await prisma.approval.count({ where: { projectId } });
  await prisma.approval.create({ data: { projectId, itemLabel, order: count } });
  revalidatePath(`/admin/projects/${projectId}/approvals`);
}

export async function deleteApproval(projectId: string, id: string) {
  await prisma.approval.delete({ where: { id } });
  revalidatePath(`/admin/projects/${projectId}/approvals`);
}

// ---------- Client (access is gated by possession of the project link, not a login) ----------

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
