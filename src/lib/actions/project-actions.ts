"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { deleteFile, saveFile } from "@/lib/storage";
import { generateProjectToken } from "@/lib/tokens";
import { logActivity } from "@/lib/activity";
import type { PipelineStatus, ProjectStage, PublishState } from "@/generated/prisma/enums";

function refresh(id?: string) {
  revalidatePath("/admin");
  if (id) {
    revalidatePath(`/admin/projects/${id}`, "layout");
  }
}

function optionalDate(value: FormDataEntryValue | null) {
  const str = String(value ?? "");
  return str ? new Date(str) : null;
}

export async function createProject(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Project name is required.");

  const project = await prisma.project.create({
    data: {
      name,
      token: generateProjectToken(name),
      clientName: String(formData.get("clientName") ?? ""),
      clientEmail: String(formData.get("clientEmail") ?? "") || null,
      clientPhone: String(formData.get("clientPhone") ?? "") || null,
      location: String(formData.get("location") ?? "") || null,
      area: String(formData.get("area") ?? "") || null,
      projectType: String(formData.get("projectType") ?? "") || null,
      description: String(formData.get("description") ?? "") || null,
      deliveryDate: optionalDate(formData.get("deliveryDate")),
    },
  });

  refresh();
  redirect(`/admin/projects/${project.id}`);
}

export async function updateProjectOverview(id: string, formData: FormData) {
  const existing = await prisma.project.findUniqueOrThrow({ where: { id } });
  const coverFile = formData.get("coverImage");
  const removeCover = formData.get("removeCoverImage") === "on";

  let coverImageUrl = existing.coverImageUrl;
  if (coverFile instanceof File && coverFile.size > 0) {
    await deleteFile(existing.coverImageUrl);
    const saved = await saveFile(coverFile, `projects/${id}/cover`, "image");
    coverImageUrl = saved.url;
  } else if (removeCover) {
    await deleteFile(existing.coverImageUrl);
    coverImageUrl = null;
  }

  await prisma.project.update({
    where: { id },
    data: {
      name: String(formData.get("name") ?? existing.name),
      clientName: String(formData.get("clientName") ?? existing.clientName),
      clientEmail: String(formData.get("clientEmail") ?? "") || null,
      clientPhone: String(formData.get("clientPhone") ?? "") || null,
      location: String(formData.get("location") ?? "") || null,
      area: String(formData.get("area") ?? "") || null,
      projectType: String(formData.get("projectType") ?? "") || null,
      description: String(formData.get("description") ?? "") || null,
      deliveryDate: optionalDate(formData.get("deliveryDate")),
      coverImageUrl,
      pipelineStatus: String(formData.get("pipelineStatus") ?? existing.pipelineStatus) as PipelineStatus,
      currentStage: String(formData.get("currentStage") ?? existing.currentStage) as ProjectStage,
      completionPercent: Number(formData.get("completionPercent") ?? existing.completionPercent),
    },
  });

  refresh(id);
}

export async function updateProjectSettings(id: string, formData: FormData) {
  await prisma.project.update({
    where: { id },
    data: {
      showPricing: formData.get("showPricing") === "on",
      showDetailedPricing: formData.get("showDetailedPricing") === "on",
      showBoqQuantities: formData.get("showBoqQuantities") === "on",
      showBoqPrices: formData.get("showBoqPrices") === "on",
      allowDownloads: formData.get("allowDownloads") === "on",
      watermarkEnabled: formData.get("watermarkEnabled") === "on",
    },
  });
  refresh(id);
}

export async function setPublishState(id: string, state: PublishState) {
  await prisma.project.update({ where: { id }, data: { publishState: state } });
  refresh(id);
}

export async function logClientNotification(id: string, type: "sent_to_client" | "sent_update") {
  await logActivity(id, type);
}

export async function regenerateProjectLink(id: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id } });
  await prisma.project.update({ where: { id }, data: { token: generateProjectToken(project.name) } });
  refresh(id);
}

export async function deleteProject(id: string) {
  const project = await prisma.project.findUnique({
    where: { id },
    include: { spaces: { include: { images: true } }, drawings: true, documents: true, materials: true, furniture: true },
  });
  if (!project) return;

  await deleteFile(project.coverImageUrl);
  for (const space of project.spaces) {
    for (const image of space.images) {
      await deleteFile(image.imageUrl);
      await deleteFile(image.beforeImageUrl);
    }
  }
  for (const d of project.drawings) await deleteFile(d.fileUrl);
  for (const d of project.documents) await deleteFile(d.fileUrl);
  for (const m of project.materials) await deleteFile(m.imageUrl);
  for (const f of project.furniture) await deleteFile(f.imageUrl);

  await prisma.project.delete({ where: { id } });
  refresh();
  redirect("/admin");
}
