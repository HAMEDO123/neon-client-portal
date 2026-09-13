"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireEmployee } from "@/lib/employee-session";
import { notifyAdmin } from "@/lib/admin-notifications";
import { getTimezone } from "@/lib/settings";
import { saveFile } from "@/lib/storage";
import { todayKey } from "@/lib/time";

// What an employee may put on a project.
//
// Separate from the admin actions on purpose. Those are guarded by
// requireAdmin and stay that way — loosening one of them to let an employee in
// would reopen the hole that was closed today, because "no admin check" does
// not mean "employees only", it means anybody at all. These check
// requireEmployee instead, which re-reads the database every request, so a
// disabled account is out on its next tap.
//
// Two rules run through all of it:
//
//   - **Adding only.** Nothing here deletes. Removing a drawing also removes
//     the file from storage and takes it off the client's page for good, and an
//     accidental tap on a phone should not be able to do that. Deleting stays
//     with the manager.
//   - **The manager is told.** The studio chose for these to reach the client
//     immediately, with nobody in between. A notification is not a gate — it
//     changes nothing about what the client sees — but it means the manager
//     learns what went out from the platform rather than from the client.

/** The project, if it is one an employee may still add to. */
async function openProject(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, token: true, publishState: true },
  });
  if (!project) throw new Error("That project no longer exists.");
  // Not a permission rule: an archived project is closed to everybody.
  if (project.publishState === "ARCHIVED") throw new Error("That project is archived.");
  return project;
}

/**
 * Both sides of the upload.
 *
 * The client's page is revalidated too, because that is what "goes live
 * immediately" actually means — without it the file is on the project and the
 * client is still looking at the cached page from before.
 */
function refresh(project: { id: string; token: string }) {
  revalidatePath(`/admin/projects/${project.id}`, "layout");
  revalidatePath("/employee/projects", "layout");
  revalidatePath(`/p/${project.token}`);
}

async function tellTheManager(
  employee: { id: string; name: string },
  project: { id: string; name: string },
  what: string,
  key: string
) {
  await notifyAdmin({
    type: "TASK_STATUS_CHANGED",
    title: `${employee.name} added to ${project.name}`,
    message: `${what} It is on the client's page now.`,
    url: `/admin/projects/${project.id}`,
    dedupeKey: key,
    employeeId: employee.id,
  }).catch(() => null);
}

export async function addProjectDrawing(projectId: string, formData: FormData) {
  const employee = await requireEmployee();
  const project = await openProject(projectId);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file to upload.");

  const name = String(formData.get("name") ?? "").trim().slice(0, 200);
  if (!name) throw new Error("Give the drawing a name.");

  const saved = await saveFile(file, `projects/${projectId}/drawings`, "document");
  const count = await prisma.drawing.count({ where: { projectId } });

  const drawing = await prisma.drawing.create({
    data: {
      projectId,
      category: String(formData.get("category") ?? "Architectural"),
      subCategory: String(formData.get("subCategory") ?? "").trim() || null,
      name,
      drawingNumber: String(formData.get("drawingNumber") ?? "").trim() || null,
      revision: String(formData.get("revision") ?? "").trim() || "R00",
      fileUrl: saved.url,
      fileType: saved.fileType,
      fileSize: saved.fileSize,
      order: count,
    },
  });

  await tellTheManager(employee, project, `Drawing: ${name}.`, `EMPLOYEE_UPLOAD:drawing:${drawing.id}`);
  refresh(project);
}

export async function addProjectDocument(projectId: string, formData: FormData) {
  const employee = await requireEmployee();
  const project = await openProject(projectId);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file to upload.");

  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  if (!title) throw new Error("Give the document a title.");

  const saved = await saveFile(file, `projects/${projectId}/documents`, "document");
  const count = await prisma.document.count({ where: { projectId } });

  const document = await prisma.document.create({
    data: {
      projectId,
      category: String(formData.get("category") ?? "Other"),
      title,
      version: String(formData.get("version") ?? "").trim() || null,
      fileUrl: saved.url,
      fileType: saved.fileType,
      fileSize: saved.fileSize,
      order: count,
    },
  });

  await tellTheManager(employee, project, `Document: ${title}.`, `EMPLOYEE_UPLOAD:document:${document.id}`);
  refresh(project);
}

/**
 * A room to put renders in.
 *
 * Photographs have to go somewhere, and a project with no spaces yet would
 * otherwise leave an employee holding a photo and no way to add it.
 */
export async function addProjectSpace(projectId: string, formData: FormData) {
  await requireEmployee();
  const project = await openProject(projectId);

  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  if (!name) throw new Error("Give the space a name, like “Living Room”.");

  const count = await prisma.gallerySpace.count({ where: { projectId } });
  await prisma.gallerySpace.create({ data: { projectId, name, order: count } });

  refresh(project);
}

/**
 * One photo into one space.
 *
 * One per request, not a batch — the same reason the admin's uploader works
 * this way, and its comment is worth repeating because the failure is invisible
 * until somebody tries it on a phone: the request body limit applies to the raw
 * upload, *before* any compression, so a handful of camera photos in one
 * request is refused however small they end up. The browser sends them one at a
 * time instead.
 */
export async function addProjectImage(projectId: string, spaceId: string, formData: FormData) {
  const employee = await requireEmployee();
  const project = await openProject(projectId);

  // The space has to belong to this project — an id from somewhere else must
  // not put a photo on a project it was never meant for.
  const space = await prisma.gallerySpace.findFirst({
    where: { id: spaceId, projectId },
    select: { id: true, name: true },
  });
  if (!space) throw new Error("That space is not on this project.");

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a photo.");

  const saved = await saveFile(file, `projects/${projectId}/gallery`, "image", true);
  const count = await prisma.galleryImage.count({ where: { spaceId } });

  await prisma.galleryImage.create({
    data: {
      spaceId,
      imageUrl: saved.url,
      caption: String(formData.get("caption") ?? "").trim().slice(0, 300) || null,
      order: count,
    },
  });

  // Keyed on the room and the day, so eight photos from one site visit reach
  // the manager as one notification rather than eight. The engine's unique
  // index does the collapsing; nothing here counts or waits.
  const day = todayKey(await getTimezone());
  await tellTheManager(
    employee,
    project,
    `Photos in ${space.name}.`,
    `EMPLOYEE_UPLOAD:images:${spaceId}:${day}`
  );
  refresh(project);
}
