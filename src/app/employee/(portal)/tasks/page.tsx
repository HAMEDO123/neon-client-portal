import Link from "next/link";
import { ListChecks } from "lucide-react";
import { requireEmployee } from "@/lib/employee-session";
import { allTasks, type EmployeeTask } from "@/lib/employee-tasks";
import { getTimezone } from "@/lib/settings";
import { dayKeyIn, shiftDayKey } from "@/lib/time";
import { TaskCard } from "@/components/employee/task-card";
import { AssignedTaskCard } from "@/components/employee/assigned-task-card";
import { planForTasks } from "@/lib/stage-deadlines";
import { myAssignedTasks, type AssignedTaskView } from "@/lib/assigned-tasks";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { AssignWork } from "@/components/tasks/assign-work";
import { SiteVisits } from "@/components/tasks/site-visits";
import { projectsForVisits, siteVisitsFor } from "@/lib/site-visit-queries";
import { assignedTasksForWeek } from "@/lib/assigned-tasks";
import { weekDayKeys, weekLabel, weekStartKey } from "@/lib/week";
import { prisma } from "@/lib/db";

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

  // Whoever the manager has trusted to hand work out gets a second view of
  // this tab. Not the manager's two tables — those are a project-by-step
  // matrix and a seven-day grid, read on a desk, and on a phone they drag the
  // page sideways under their own headings. This is the same job without
  // them: a button, and the form asking who it is for and what it is.
  //
  // A view of the Tasks tab rather than a seventh destination, because the
  // phone's tab bar is already full and this is tasks either way.
  const assigning = employee.canAssignTasks && view === "studio";

  // The site-visit diary, for whoever keeps it. A third view of this tab
  // rather than a destination of its own, for the same reason Assign is one:
  // the phone's tab bar is full, and all three are this person's work.
  if (employee.canLogSiteVisits && view === "visits") {
    const [visits, projects] = await Promise.all([siteVisitsFor(employee.id), projectsForVisits()]);

    return (
      <div className="flex flex-col gap-4">
        <ViewSwitch view="visits" canAssign={employee.canAssignTasks} canVisit />
        <SiteVisits visits={visits} projects={projects} />
      </div>
    );
  }

  if (assigning) {
    const anchor = /^\d{4}-\d{2}-\d{2}$/.test(week ?? "") ? week! : dayKeyIn(timezone, new Date());
    const keys = weekDayKeys(anchor);
    const start = weekStartKey(anchor);

    const [team, tasks] = await Promise.all([
      prisma.employee.findMany({
        where: { active: true, accessRole: "EMPLOYEE" },
        orderBy: [{ order: "asc" }, { name: "asc" }],
        select: { id: true, name: true, color: true, role: true, photoUrl: true },
      }),
      assignedTasksForWeek(anchor),
    ]);

    return (
      <div className="flex flex-col gap-4">
        <ViewSwitch view="studio" canAssign canVisit={employee.canLogSiteVisits} />
        <AssignWork
          team={team}
          tasks={tasks}
          todayKey={dayKeyIn(timezone, new Date())}
          weekLabel={weekLabel(keys)}
          previousWeek={`/employee/tasks?view=studio&week=${shiftDayKey(start, -7)}`}
          nextWeek={`/employee/tasks?view=studio&week=${shiftDayKey(start, 7)}`}
          thisWeek="/employee/tasks?view=studio"
          isThisWeek={start === weekStartKey(dayKeyIn(timezone, new Date()))}
        />
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
      {employee.canAssignTasks || employee.canLogSiteVisits ? (
        <ViewSwitch
          view="mine"
          canAssign={employee.canAssignTasks}
          canVisit={employee.canLogSiteVisits}
        />
      ) : (
        <h1 className="text-xl font-semibold text-ink">My Tasks</h1>
      )}

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
 * My own work, handing work out, and the site-visit diary.
 *
 * Only the views this person actually has are drawn — for somebody with
 * neither extra, the tab has one view, and a switch with a single destination
 * is a control that asks a question with one answer.
 */
function ViewSwitch({
  view,
  canAssign,
  canVisit,
}: {
  view: "mine" | "studio" | "visits";
  canAssign: boolean;
  canVisit: boolean;
}) {
  const options = [
    { key: "mine", label: "My tasks", href: "/employee/tasks", shown: true },
    { key: "studio", label: "Assign", href: "/employee/tasks?view=studio", shown: canAssign },
    { key: "visits", label: "Site visits", href: "/employee/tasks?view=visits", shown: canVisit },
  ].filter((option) => option.shown);

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Link
          key={option.key}
          href={option.href}
          className={cn(
            "rounded-full border px-4 py-2 text-sm font-semibold transition-colors",
            view === option.key ? "border-ink bg-ink text-bg" : "border-ink/12 bg-white/60 text-ink/60"
          )}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}
