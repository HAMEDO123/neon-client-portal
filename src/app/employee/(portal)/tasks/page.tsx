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
import { chipClass, chipCountClass } from "@/components/tasks/filter-chip";
import { countByFilter, isLate, matchesFilter, readTaskFilter, type Filterable, type TaskFilter } from "@/lib/task-filters";

// "Open" is still where the tab lands — what there is to do — and the four the
// studio asked for sit beside it, so work under way, work with the manager and
// work that is late are each one press away instead of one mixed list.
// "Completed" rather than "Done": it is the word on the cards below.
const FILTERS: { key: TaskFilter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "progress", label: "In progress" },
  { key: "review", label: "Sent for review" },
  { key: "late", label: "Late" },
  { key: "done", label: "Completed" },
  { key: "all", label: "All" },
];

// What an empty list says, which depends on what was asked for.
const EMPTY: Record<TaskFilter, { title: string; description: string }> = {
  open: {
    title: "No tasks assigned",
    description: "When an admin assigns you work, it appears here and you get a notification.",
  },
  all: {
    title: "No tasks assigned",
    description: "When an admin assigns you work, it appears here and you get a notification.",
  },
  progress: { title: "Nothing in progress", description: "Start a task and it is listed here." },
  review: {
    title: "Nothing waiting for review",
    description: "Work you send in stays here until the manager has looked at it.",
  },
  late: { title: "Nothing is late", description: "Work that passes its day without being approved shows here." },
  done: { title: "Nothing completed yet", description: "Tasks you finish will be listed here." },
};

// Everything on one list, soonest due first, whatever kind of work it is — a
// step on a project and a job from the manager compete for the same hours.
type ListItem = Filterable &
  ({ kind: "board"; task: EmployeeTask; due: string } | { kind: "assigned"; task: AssignedTaskView; due: string });

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

  const active = readTaskFilter(filter);
  const today = dayKeyIn(timezone, new Date());

  // Everything, read once and narrowed here: each button says how many it
  // holds, and a count needs the tasks the list is not showing.
  const tasks = await allTasks(employee.id);
  const plan = await planForTasks(tasks);
  const assigned = await myAssignedTasks(employee.id, { includeDone: true });

  const everything: ListItem[] = [
    ...tasks.map((task) => {
      const deadline = plan.get(task.id)?.dueBy ?? null;
      const due = deadline ?? task.dueAt ?? task.scheduledFor;
      return {
        kind: "board" as const,
        task,
        due: due ? dayKeyIn(timezone, due) : NO_DATE,
        state: task.state,
        // Late by the deadline the card counts down to, and by nothing else:
        // the filter must list exactly the cards that say "late".
        late: isLate(task.state, deadline ? dayKeyIn(timezone, deadline) : null, today),
      };
    }),
    ...assigned.map((task) => ({
      kind: "assigned" as const,
      task,
      due: task.endKey,
      state: task.state,
      late: isLate(task.state, task.endKey, today),
    })),
  ];

  const counts = countByFilter(everything);
  const items = everything
    .filter((item) => matchesFilter(item, active))
    .sort((a, b) => a.due.localeCompare(b.due) || PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority]);

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

      {/* Wraps rather than scrolls: six buttons are two rows on a phone, and
          every one of them stays in sight. */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((option) => (
          <Link
            key={option.key}
            href={`/employee/tasks?filter=${option.key}`}
            scroll={false}
            className={chipClass(option.key, active, counts[option.key])}
          >
            {option.label}
            <span className={chipCountClass(option.key, active)}>{counts[option.key]}</span>
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState
          className="mt-2"
          icon={ListChecks}
          title={EMPTY[active].title}
          description={EMPTY[active].description}
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
