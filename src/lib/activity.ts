import { prisma } from "@/lib/db";

export type ActivityType =
  | "viewed_project"
  | "viewed_render"
  | "viewed_drawing"
  | "downloaded_drawing"
  | "downloaded_document"
  | "downloaded_image"
  | "downloaded_package"
  | "viewed_boq"
  | "viewed_pricing"
  | "approved"
  | "requested_changes"
  | "commented"
  | "sent_to_client"
  | "sent_update";

export async function logActivity(projectId: string, type: ActivityType, detail?: string) {
  await prisma.projectActivity.create({ data: { projectId, type, detail } }).catch(() => {});
}
