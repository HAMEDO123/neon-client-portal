import { notFound } from "next/navigation";
import { requireEmployee } from "@/lib/employee-session";
import { AssignedTaskDetail } from "@/components/employee/assigned-task-detail";

// A job handed to this person, on a page of its own. The content is
// components/employee/assigned-task-detail.tsx, which the Tasks list also
// shows beside itself on a desk.
export default async function AssignedTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const employee = await requireEmployee();
  const { id } = await params;

  const detail = await AssignedTaskDetail({ employeeId: employee.id, id });
  if (!detail) notFound();
  return detail;
}
