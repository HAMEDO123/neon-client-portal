import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { getProjectById } from "@/lib/queries";
import { createDrawing } from "@/lib/actions/drawing-actions";
import { TextInput, Select } from "@/components/admin/fields";
import { SaveButton } from "@/components/admin/form-buttons";
import { EmptyState } from "@/components/ui/empty-state";
import { DRAWING_CATEGORIES, toOptions } from "@/lib/constants";
import { DrawingRow } from "@/components/admin/drawing-row";

export default async function DrawingsAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  return (
    <div className="flex flex-col gap-6">
      <form
        action={createDrawing.bind(null, project.id)}
        className="glass grid grid-cols-1 gap-3 rounded-2xl p-6 sm:grid-cols-3"
      >
        <Select label="Category" name="category" defaultValue="Architectural" options={toOptions(DRAWING_CATEGORIES)} />
        <TextInput label="Sub-category" name="subCategory" placeholder="Floor Plans" defaultValue="" required={false} />
        <TextInput label="Drawing Name" name="name" placeholder="Ground Floor Plan" defaultValue="" />
        <TextInput label="Drawing Number" name="drawingNumber" placeholder="A-101" defaultValue="" required={false} />
        <TextInput label="Revision" name="revision" defaultValue="R00" />
        <div>
          <label className="mb-1 block text-xs font-medium text-ink/50">File (PDF, DWG…)</label>
          <input type="file" name="file" required className="text-xs" />
        </div>
        <div className="sm:col-span-3">
          <SaveButton label="Add Drawing" />
        </div>
      </form>

      {project.drawings.length === 0 ? (
        <EmptyState icon={FileText} title="No drawings yet" description="Upload the first technical drawing above." />
      ) : (
        <div className="flex flex-col gap-2">
          {project.drawings.map((d) => (
            <DrawingRow key={d.id} projectId={project.id} drawing={d} />
          ))}
        </div>
      )}
    </div>
  );
}
