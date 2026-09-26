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
import { StudioTasks } from "@/components/tasks/studio-tasks";

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
  searchParams: Promise<{ filter?: string; view?: string; week?: string }>;
}) {
  const employee = await requireEmployee();
  const timezone = await getTimezone();
  const { filter, view, week } = await searchParams;

  // Whoever the manager has trusted to hand work out gets the studio's own two
  // tables in this tab as well — the same screen the manager has, mounted
  // without the rights that were not handed over. Two views of one tab rather
  // than a seventh destination: the phone's tab bar is already full, and this
  // is the Tasks tab either way.
  const studio = employee.canAssignTasks && view === "studio";

  if (studio) {
    return (
      // `wide-frame` lifts the portal's reading width for this page only: the
      // board is a project-by-step matrix and a 5xl column puts half of it off
      // the side. The selector matches a **direct** child of `.employee-main`,
      // like `fills-frame` beside it, so this div cannot be wrapped.
      <div className="wide-frame">
        <ViewSwitch studio />
        <StudioTasks week={week} basePath="/employee/tasks" asManager={false} />
      </div>
    );
  }

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
      {employee.canAssignTasks ? <ViewSwitch studio={false} /> : <h1 className="text-xl font-semibold text-ink">My Tasks</h1>}

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

/**
 * Mine, or the studio's.
 *
 * Only drawn for somebody who may hand work out — for everyone else this tab
 * has one view and a switch with a single destination is a control that asks a
 * question with one answer.
 */
function ViewSwitch({ studio }: { studio: boolean }) {
  const options = [
    { key: "mine", label: "My tasks", href: "/employee/tasks" },
    { key: "studio", label: "Studio", href: "/employee/tasks?view=studio" },
  ];

  return (
    <div className="flex gap-2">
      {options.map((option) => {
        const active = studio ? option.key === "studio" : option.key === "mine";
        return (
          <Link
            key={option.key}
            href={option.href}
            className={cn(
              "rounded-full border px-4 py-2 text-sm font-semibold transition-colors",
              active ? "border-ink bg-ink text-bg" : "border-ink/12 bg-white/60 text-ink/60"
            )}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}
