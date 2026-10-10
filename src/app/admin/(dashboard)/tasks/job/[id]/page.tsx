import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { prisma } from "@/lib/db";
import { dateToDayKey } from "@/lib/time";

// Where a job quoted in a chat opens for the manager: the week it is on.
//
// A question about a task carries the task's id and nothing about when it is
// (lib/task-questions.ts), and the week board shows one week at a time — so the
// link comes here, and here is where the week is looked up. A job that has
// since been deleted lands on this week rather than on "not found".
export default async function JobInItsWeek({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const job = await prisma.assignedTask.findUnique({ where: { id }, select: { startDay: true } });
  redirect(job ? `/admin/tasks?week=${dateToDayKey(job.startDay)}` : "/admin/tasks");
}
