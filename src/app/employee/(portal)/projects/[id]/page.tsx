import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, FileText, FolderOpen, Images } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireEmployee } from "@/lib/employee-session";
import {
  addProjectDocument,
  addProjectDrawing,
  addProjectSpace,
} from "@/lib/actions/employee-project-actions";
import { ProjectPhotoUpload } from "@/components/employee/project-photo-upload";
import { TextInput, Select } from "@/components/admin/fields";
import { SaveButton } from "@/components/admin/form-buttons";
import { DOCUMENT_CATEGORIES, DRAWING_CATEGORIES, toOptions } from "@/lib/constants";
import { formatFileSize } from "@/lib/format";

// One project, from the employee's side: what is on it, and how to add to it.
//
// Single column and big targets — this is used standing on a site, on a phone,
// not at a desk. The admin's own version of these forms is three columns wide
// and assumes a mouse.

export default async function EmployeeProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireEmployee();
  const { id } = await params;

  const project = await prisma.project.findFirst({
    where: { id, publishState: { not: "ARCHIVED" } },
    select: {
      id: true,
      name: true,
      clientName: true,
      location: true,
      publishState: true,
      spaces: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          name: true,
          images: { orderBy: { order: "asc" }, select: { id: true, imageUrl: true, caption: true } },
        },
      },
      drawings: {
        orderBy: [{ category: "asc" }, { order: "asc" }],
        select: { id: true, name: true, category: true, revision: true, fileUrl: true, fileType: true, fileSize: true },
      },
      documents: {
        orderBy: [{ category: "asc" }, { order: "asc" }],
        select: { id: true, title: true, category: true, version: true, fileUrl: true, fileType: true, fileSize: true },
      },
    },
  });
  if (!project) notFound();

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/employee/projects"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/45 hover:text-ink"
      >
        <ArrowLeft size={15} strokeWidth={2} />
        Projects
      </Link>

      <div>
        <h1 className="text-xl font-semibold text-ink">{project.name}</h1>
        <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-ink/50">
          <Building2 size={14} strokeWidth={1.75} />
          {project.clientName}
          {project.location ? ` · ${project.location}` : ""}
        </p>
      </div>

      {/* Said plainly, on the screen where the uploading happens: this is
          publishing, not saving. */}
      <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        {project.publishState === "PUBLISHED"
          ? "Anything you add here is on the client’s page straight away."
          : "This project is not published yet, so the client sees nothing until the manager publishes it."}
      </p>

      {/* --- Photos ------------------------------------------------------- */}
      <section className="glass rounded-2xl p-4">
        <h2 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink/40">
          <Images size={13} strokeWidth={2} />
          Photos
        </h2>

        {project.spaces.length === 0 ? (
          <p className="mt-2 text-sm text-ink/45">
            Photos go in a room — add one below, then you can add photos to it.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {project.spaces.map((space) => (
              <div key={space.id}>
                <p className="text-sm font-medium text-ink">{space.name}</p>

                {space.images.length > 0 && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {space.images.map((image) => (
                      <div key={image.id} className="relative aspect-square overflow-hidden rounded-lg border border-ink/8">
                        <Image
                          src={image.imageUrl}
                          alt={image.caption ?? space.name}
                          fill
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                    ))}
                  </div>
                )}

                <ProjectPhotoUpload projectId={project.id} spaceId={space.id} />
              </div>
            ))}
          </div>
        )}

        <form action={addProjectSpace.bind(null, project.id)} className="mt-4 flex flex-wrap items-end gap-2">
          <TextInput label="Add a room" name="name" placeholder="Living Room" defaultValue="" className="min-w-40 flex-1" />
          <SaveButton label="Add" />
        </form>
      </section>

      {/* --- Drawings ----------------------------------------------------- */}
      <section className="glass rounded-2xl p-4">
        <h2 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink/40">
          <FileText size={13} strokeWidth={2} />
          Drawings
        </h2>

        {project.drawings.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {project.drawings.map((drawing) => (
              <li key={drawing.id} className="flex items-center gap-2 rounded-xl border border-ink/8 bg-white/50 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{drawing.name}</p>
                  <p className="text-[11px] text-ink/40">
                    {drawing.category} · {drawing.revision} · {drawing.fileType.toUpperCase()}
                    {drawing.fileSize ? ` · ${formatFileSize(drawing.fileSize)}` : ""}
                  </p>
                </div>
                <a href={drawing.fileUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-cyan-strong">
                  View
                </a>
              </li>
            ))}
          </ul>
        )}

        <form action={addProjectDrawing.bind(null, project.id)} className="mt-3 flex flex-col gap-3">
          <Select label="Category" name="category" defaultValue="Architectural" options={toOptions(DRAWING_CATEGORIES)} />
          <TextInput label="Name" name="name" placeholder="Ground Floor Plan" defaultValue="" />
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="Number" name="drawingNumber" placeholder="A-101" defaultValue="" required={false} />
            <TextInput label="Revision" name="revision" defaultValue="R00" required={false} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink/50">File (PDF, DWG…)</label>
            <input type="file" name="file" required className="text-xs" />
          </div>
          <SaveButton label="Add drawing" />
        </form>
      </section>

      {/* --- Documents ---------------------------------------------------- */}
      <section className="glass rounded-2xl p-4">
        <h2 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink/40">
          <FolderOpen size={13} strokeWidth={2} />
          Documents
        </h2>

        {project.documents.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {project.documents.map((document) => (
              <li key={document.id} className="flex items-center gap-2 rounded-xl border border-ink/8 bg-white/50 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{document.title}</p>
                  <p className="text-[11px] text-ink/40">
                    {document.category}
                    {document.version ? ` · ${document.version}` : ""} · {document.fileType.toUpperCase()}
                    {document.fileSize ? ` · ${formatFileSize(document.fileSize)}` : ""}
                  </p>
                </div>
                <a href={document.fileUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-cyan-strong">
                  View
                </a>
              </li>
            ))}
          </ul>
        )}

        <form action={addProjectDocument.bind(null, project.id)} className="mt-3 flex flex-col gap-3">
          <Select label="Category" name="category" defaultValue="Specifications" options={toOptions(DOCUMENT_CATEGORIES)} />
          <TextInput label="Title" name="title" placeholder="Site report" defaultValue="" />
          <TextInput label="Version" name="version" placeholder="v1" defaultValue="" required={false} />
          <div>
            <label className="mb-1 block text-xs font-medium text-ink/50">File</label>
            <input type="file" name="file" required className="text-xs" />
          </div>
          <SaveButton label="Add document" />
        </form>
      </section>
    </div>
  );
}
