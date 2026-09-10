import Link from "next/link";
import { ListChecks } from "lucide-react";
import { requireEmployee } from "@/lib/employee-session";
import { allTasks, type EmployeeTask } from "@/lib/employee-tasks";
import { getTimezone } from "@/lib/settings";
import { dayKeyIn } from "@/lib/time";
import { TaskCard } from "@/components/employee/task-card";
import { AssignedTaskCard } from "@/components/employee/assigned-task-card";
import { planForTasks } from "@/lib/stage-deadlines";
import { myAssignedTasks, type AssignedTaskView } from "@/lib/assigned-tasks";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "completed", label: "Completed" },
  { key: "all", label: "All" },
] as const;

// Everything on one list, soonest due first, whatever kind of work it is — a
// step on a project and a job from the manager compete for the same hours.
type ListItem =
  | { kind: "board"; task: EmployeeTask; due: string }
  | { kind: "assigned"; task: AssignedTaskView; due: string };

const PRIORITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

// Work with no date at all sorts after everything that has one.
const NO_DATE = "9999-12-31";

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
  const plan = await planForTasks(tasks);

  const assigned = (await myAssignedTasks(employee.id, { includeDone: true })).filter((task) =>
    active === "completed" ? task.state === "DONE" : active === "open" ? task.state !== "DONE" : true
  );

  const items: ListItem[] = [
    ...tasks.map((task) => {
      const due = plan.get(task.id)?.dueBy ?? task.dueAt ?? task.scheduledFor;
      return { kind: "board" as const, task, due: due ? dayKeyIn(timezone, due) : NO_DATE };
    }),
    ...assigned.map((task) => ({ kind: "assigned" as const, task, due: task.endKey })),
  ].sort(
    (a, b) => a.due.localeCompare(b.due) || PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority]
  );

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
              active === option.key ? "border-ink bg-ink text-bg" : "border-ink/12 bg-white/60 text-ink/60"
            )}
          >
            {option.label}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
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
          {items.map((item) =>
            item.kind === "board" ? (
              <TaskCard
                key={item.task.id}
                task={item.task}
                timezone={timezone}
                dueBy={plan.get(item.task.id)?.dueBy}
                startsAt={plan.get(item.task.id)?.startsAt}
              />
            ) : (
              <AssignedTaskCard key={item.task.id} task={item.task} timezone={timezone} />
            )
          )}
        </div>
      )}
    </div>
  );
}
