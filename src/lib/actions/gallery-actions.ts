"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { deleteFile, saveFile } from "@/lib/storage";

function refresh(projectId: string) {
  revalidatePath(`/admin/projects/${projectId}/gallery`);
}

export async function createSpace(projectId: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const count = await prisma.gallerySpace.count({ where: { projectId } });
  await prisma.gallerySpace.create({ data: { projectId, name, order: count } });
  refresh(projectId);
}

export async function deleteSpace(projectId: string, id: string) {
  const space = await prisma.gallerySpace.findUnique({ where: { id }, include: { images: true } });
  if (space) {
    for (const image of space.images) {
      await deleteFile(image.imageUrl);
      await deleteFile(image.beforeImageUrl);
    }
  }
  await prisma.gallerySpace.delete({ where: { id } });
  refresh(projectId);
}

export async function addImage(projectId: string, spaceId: string, formData: FormData) {
  const files = formData.getAll("image").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) throw new Error("Select at least one image to upload.");

  const caption = String(formData.get("caption") ?? "") || null;
  const isBeforeAfter = formData.get("isBeforeAfter") === "on";
  const beforeFile = formData.get("beforeImage");
  const compress = formData.get("compress") === "on";

  let count = await prisma.galleryImage.count({ where: { spaceId } });

  if (isBeforeAfter) {
    // Before/after pairing only makes sense for a single "after" image at a time.
    const saved = await saveFile(files[0], `projects/${projectId}/gallery`, "image", compress);
    let beforeImageUrl: string | null = null;
    if (beforeFile instanceof File && beforeFile.size > 0) {
      beforeImageUrl = (await saveFile(beforeFile, `projects/${projectId}/gallery`, "image", compress)).url;
    }
    await prisma.galleryImage.create({
      data: {
        spaceId,
        imageUrl: saved.url,
        caption,
        isBeforeAfter: !!beforeImageUrl,
        beforeImageUrl,
        order: count,
      },
    });
  } else {
    for (const file of files) {
      const saved = await saveFile(file, `projects/${projectId}/gallery`, "image", compress);
      await prisma.galleryImage.create({
        data: { spaceId, imageUrl: saved.url, caption, order: count },
      });
      count += 1;
    }
  }

  refresh(projectId);
}

export async function deleteImage(projectId: string, id: string) {
  const image = await prisma.galleryImage.findUnique({ where: { id } });
  if (image) {
    await deleteFile(image.imageUrl);
    await deleteFile(image.beforeImageUrl);
  }
  await prisma.galleryImage.delete({ where: { id } });
  refresh(projectId);
}
