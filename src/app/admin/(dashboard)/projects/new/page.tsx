import { createProject } from "@/lib/actions/project-actions";
import { TextInput, TextArea } from "@/components/admin/fields";
import { SaveButton } from "@/components/admin/form-buttons";

export default function NewProjectPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">New Project</h1>
      <p className="mt-1 text-sm text-ink/50">
        Start with the essentials — you can add renders, drawings, BOQ, and pricing right after.
      </p>

      <form action={createProject} className="glass mt-8 flex max-w-2xl flex-col gap-4 rounded-2xl p-6">
        <TextInput label="Project Name" name="name" placeholder="Villa Al-Fulan" defaultValue="" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextInput label="Client Name" name="clientName" placeholder="Mr. Ahmad Al-Fulan" defaultValue="" />
          <TextInput label="Client Email" name="clientEmail" type="email" defaultValue="" required={false} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextInput label="Client Phone" name="clientPhone" defaultValue="" required={false} />
          <TextInput label="Delivery Date" name="deliveryDate" type="date" defaultValue="" required={false} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TextInput label="Location" name="location" placeholder="Amman, Jordan" defaultValue="" required={false} />
          <TextInput label="Area" name="area" placeholder="320 m²" defaultValue="" required={false} />
          <TextInput
            label="Project Type"
            name="projectType"
            placeholder="Interior Design & Execution"
            defaultValue=""
            required={false}
          />
        </div>
        <TextArea label="Description" name="description" rows={3} defaultValue="" />
        <div>
          <SaveButton label="Create Project" />
        </div>
      </form>
    </div>
  );
}
