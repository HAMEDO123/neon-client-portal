import { notFound } from "next/navigation";
import { getProjectById } from "@/lib/queries";
import { updateProjectOverview, updateProjectSettings, deleteProject } from "@/lib/actions/project-actions";
import { TextInput, TextArea, Select, Checkbox } from "@/components/admin/fields";
import { SaveButton, DeleteButton } from "@/components/admin/form-buttons";
import { PROJECT_STAGES, PIPELINE_STATUSES } from "@/lib/constants";

function toDateInput(date: Date | null) {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

export default async function ProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-lg font-semibold text-ink">Project Details</h2>
        <form
          action={updateProjectOverview.bind(null, project.id)}
          className="glass mt-4 flex flex-col gap-4 rounded-2xl p-6"
        >
          <div className="flex gap-4">
            <div
              className="h-24 w-36 shrink-0 rounded-xl bg-cover bg-center bg-ink/5"
              style={project.coverImageUrl ? { backgroundImage: `url(${project.coverImageUrl})` } : undefined}
            />
            <div className="flex flex-1 flex-col gap-2">
              <label className="mb-1 block text-xs font-medium text-ink/50">
                {project.coverImageUrl ? "Replace cover image" : "Upload cover image"}
              </label>
              <input type="file" name="coverImage" accept="image/jpeg,image/png,image/webp,image/avif" className="text-xs" />
              {project.coverImageUrl && (
                <label className="mt-1 flex items-center gap-2 text-xs text-ink/50">
                  <input type="checkbox" name="removeCoverImage" className="h-3.5 w-3.5" />
                  Remove current cover image
                </label>
              )}
            </div>
          </div>

          <TextInput label="Project Name" name="name" defaultValue={project.name} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInput label="Client Name" name="clientName" defaultValue={project.clientName} />
            <TextInput label="Client Email" name="clientEmail" defaultValue={project.clientEmail ?? ""} required={false} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInput label="Client Phone" name="clientPhone" defaultValue={project.clientPhone ?? ""} required={false} />
            <TextInput label="Delivery Date" name="deliveryDate" type="date" defaultValue={toDateInput(project.deliveryDate)} required={false} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <TextInput label="Location" name="location" defaultValue={project.location ?? ""} required={false} />
            <TextInput label="Area" name="area" defaultValue={project.area ?? ""} required={false} />
            <TextInput label="Project Type" name="projectType" defaultValue={project.projectType ?? ""} required={false} />
          </div>
          <TextArea label="Description" name="description" defaultValue={project.description ?? ""} />

          <div className="grid grid-cols-1 gap-4 border-t border-ink/8 pt-4 sm:grid-cols-3">
            <Select label="Pipeline Status" name="pipelineStatus" defaultValue={project.pipelineStatus} options={[...PIPELINE_STATUSES]} />
            <Select label="Journey Stage" name="currentStage" defaultValue={project.currentStage} options={[...PROJECT_STAGES]} />
            <TextInput
              label="Completion %"
              name="completionPercent"
              type="number"
              defaultValue={project.completionPercent}
              required={false}
            />
          </div>

          <div>
            <SaveButton label="Save Details" />
          </div>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-ink">Client Visibility Settings</h2>
        <p className="mt-1 text-sm text-ink/50">Control exactly what this client sees and can download.</p>
        <form action={updateProjectSettings.bind(null, project.id)} className="glass mt-4 flex flex-col gap-3 rounded-2xl p-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Checkbox
              label="Show Execution Pricing"
              name="showPricing"
              defaultChecked={project.showPricing}
              description="Hide entirely until the proposal is ready."
            />
            <Checkbox
              label="Show Detailed Pricing Breakdown"
              name="showDetailedPricing"
              defaultChecked={project.showDetailedPricing}
              description="Otherwise only the total is shown."
            />
            <Checkbox
              label="Show BOQ Quantities"
              name="showBoqQuantities"
              defaultChecked={project.showBoqQuantities}
            />
            <Checkbox label="Show BOQ Unit Prices" name="showBoqPrices" defaultChecked={project.showBoqPrices} />
            <Checkbox
              label="Allow File Downloads"
              name="allowDownloads"
              defaultChecked={project.allowDownloads}
              description="Drawings, documents, and the handover package."
            />
            <Checkbox
              label="Enable Watermark"
              name="watermarkEnabled"
              defaultChecked={project.watermarkEnabled}
              description="Overlays “NEON DESIGN — CONFIDENTIAL” on renders."
            />
          </div>
          <div>
            <SaveButton label="Save Settings" />
          </div>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-red-600">Danger Zone</h2>
        <div className="mt-4 flex items-center justify-between rounded-2xl border border-red-200 bg-red-50/50 p-6">
          <p className="text-sm text-ink/60">Permanently delete this project and all of its files. This cannot be undone.</p>
          <form>
            <DeleteButton
              formAction={deleteProject.bind(null, project.id)}
              label="Delete Project"
              confirmMessage={`Delete "${project.name}" and all of its files permanently? This cannot be undone.`}
            />
          </form>
        </div>
      </section>
    </div>
  );
}
