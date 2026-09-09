import Link from "next/link";
import { ListChecks } from "lucide-react";
import { requireEmployee } from "@/lib/employee-session";
import { allTasks } from "@/lib/employee-tasks";
import { getTimezone } from "@/lib/settings";
import { TaskCard } from "@/components/employee/task-card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "completed", label: "Completed" },
  { key: "all", label: "All" },
] as const;

export default async function EmployeeTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const employee = await requireEmployee();
  const timezone = await getTimezone();
  const { filter } = await searchParams;

  const active = FILTERS.find((f) => f.key === filter)?.key ?? "open";
  const tasks = await allTasks(employee.id, active === "all" ? undefined : active);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-ink">My Tasks</h1>

      <div className="flex gap-2">
        {FILTERS.map((option) => (
          <Link
            key={option.key}
            href={`/employee/tasks?filter=${option.key}`}
            className={cn(
              "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
              active === option.key
                ? "border-ink bg-ink text-bg"
                : "border-ink/12 bg-white/60 text-ink/60"
            )}
          >
            {option.label}
          </Link>
        ))}
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          className="mt-2"
          icon={ListChecks}
          title={active === "completed" ? "Nothing completed yet" : "No tasks assigned"}
          description={
            active === "completed"
              ? "Tasks you finish will be listed here."
              : "When an admin assigns you work, it appears here and you get a notification."
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} timezone={timezone} />
          ))}
        </div>
      )}
    </div>
  );
}
