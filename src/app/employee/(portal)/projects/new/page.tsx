import { NewProjectForm } from "@/components/admin/new-project-form";

// The manager's own form, re-exported — see the note in the component.
export default function EmployeeNewProjectPage() {
  return <NewProjectForm portal="employee" />;
}
