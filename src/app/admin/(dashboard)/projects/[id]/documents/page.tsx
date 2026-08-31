import { notFound } from "next/navigation";
import { FolderOpen } from "lucide-react";
import { getProjectById } from "@/lib/queries";
import { createDocument, deleteDocument } from "@/lib/actions/document-actions";
import { TextInput, Select } from "@/components/admin/fields";
import { SaveButton, DeleteButton } from "@/components/admin/form-buttons";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { DOCUMENT_CATEGORIES, toOptions } from "@/lib/constants";
import { formatFileSize } from "@/lib/format";

export default async function DocumentsAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  return (
    <div className="flex flex-col gap-6">
      <form
        action={createDocument.bind(null, project.id)}
        className="glass grid grid-cols-1 gap-3 rounded-2xl p-6 sm:grid-cols-4"
      >
        <Select label="Category" name="category" defaultValue="Specifications" options={toOptions(DOCUMENT_CATEGORIES)} />
        <TextInput label="Title" name="title" placeholder="Design Contract" defaultValue="" className="sm:col-span-2" />
        <TextInput label="Version" name="version" placeholder="v1" defaultValue="" required={false} />
        <div className="sm:col-span-3">
          <label className="mb-1 block text-xs font-medium text-ink/50">File</label>
          <input type="file" name="file" required className="text-xs" />
        </div>
        <div>
          <SaveButton label="Add Document" />
        </div>
      </form>

      {project.documents.length === 0 ? (
        <EmptyState icon={FolderOpen} title="No documents yet" description="Upload contracts, reports, or specifications above." />
      ) : (
        <div className="flex flex-col gap-2">
          {project.documents.map((d) => (
            <div key={d.id} className="glass flex flex-wrap items-center gap-3 rounded-xl p-4">
              <Badge tone="purple">{d.category}</Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{d.title}</p>
                <p className="mt-0.5 text-xs text-ink/40">
                  {d.version ? `${d.version} · ` : ""}
                  {d.fileType.toUpperCase()} {d.fileSize ? `· ${formatFileSize(d.fileSize)}` : ""}
                </p>
              </div>
              <a href={d.fileUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-cyan-strong">
                View
              </a>
              <form>
                <DeleteButton formAction={deleteDocument.bind(null, project.id, d.id)} />
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
