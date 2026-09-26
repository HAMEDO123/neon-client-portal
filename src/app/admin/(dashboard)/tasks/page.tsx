import { StudioTasks } from "@/components/tasks/studio-tasks";

// The manager's Tasks screen.
//
// The screen itself lives in components/tasks/studio-tasks.tsx, because the
// same two tables are now open in the employee portal for whoever the manager
// has trusted to hand work out. This page is the manager's mounting of it:
// full rights, and the admin's own URL for the week arrows.

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;

  return <StudioTasks week={week} basePath="/admin/tasks" asManager />;
}
