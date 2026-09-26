import Link from "next/link";
import { CheckCircle2, Clock, FolderKanban, Loader, Plus } from "lucide-react";
import { getTaskBoard } from "@/lib/queries";
import { getTimezone } from "@/lib/settings";
import { dayKeyIn, formatDayIn, todayKey, tomorrowKey } from "@/lib/time";
import { planForProjects } from "@/lib/stage-deadlines";
import { StateBadge } from "@/components/ui/state-badge";
import { assignedTasksForWeek } from "@/lib/assigned-tasks";
import { weekDayKeys, weekStartKey } from "@/lib/week";
import { TaskBoard } from "@/components/admin/task-board";
import { WeekView } from "@/components/admin/week-view";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

// Two tables, because the studio runs on two kinds of work.
//
// The board above is the delivery process: every project against the same
// sections, ticked off as it moves. The week below is everything else — the
// jobs the manager hands out by hand, over the days they run for. The four
// counts on top are the answers you would otherwise read the board for.

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const timezone = await getTimezone();
  const today = todayKey(timezone);
  const tomorrow = tomorrowKey(timezone);

  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(week ?? "") ? week! : today;

  // Sequential, like the rest of the multi-query pages here.
  const board = await getTaskBoard();
  const assigned = await assignedTasksForWeek(anchor);

  // The same rule the board's own percentages use: work marked "not counted"
  // is out of the totals, and a job handed out for tomorrow is due tomorrow
  // just as much as a step flagged for it.
  const cells = board.rows.flatMap((row) => row.cells);
  const counted = cells.filter((cell) => !cell.excludedFromProgress);
  const done = counted.filter((cell) => cell.state === "DONE").length;
  const working = cells.filter((cell) => cell.state === "IN_PROGRESS").length;
  const dueTomorrow =
    cells.filter((cell) => cell.state === "TOMORROW").length +
    assigned.filter((task) => task.startKey === tomorrow).length;

  // What the stage periods say is due next, across every project: the same
  // plan the employee's own countdown is built from, soonest first.
  const plan = await planForProjects(board.rows.map((row) => row.project.id));
  const soonest = [...plan.values()]
    .filter((stage) => stage.state !== "DONE" && !stage.excludedFromProgress && stage.dueBy)
    .sort((a, b) => a.dueBy!.getTime() - b.dueBy!.getTime());

  // Two per project at most: one project running late would otherwise fill the
  // panel with its own stages and hide everybody else's week.
  const takenPerProject = new Map<string, number>();
  const upcoming = soonest
    .filter((stage) => {
      const taken = takenPerProject.get(stage.projectId) ?? 0;
      if (taken >= 2) return false;
      takenPerProject.set(stage.projectId, taken + 1);
      return true;
    })
    .slice(0, 6);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-ink">Tasks</h1>
          <p className="mt-1 text-sm text-ink/50">
            Plan, track and deliver interior design projects with your team.
          </p>
        </div>

        <Link
          href="/admin/projects/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple to-purple-strong px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          <Plus size={16} strokeWidth={2.5} />
          New project
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={FolderKanban} tone="purple" label="Active projects" value={board.rows.length} />
        <Stat icon={CheckCircle2} tone="emerald" label="Steps completed" value={done} hint={`of ${counted.length}`} />
        <Stat icon={Loader} tone="cyan" label="In progress" value={working} />
        <Stat icon={Clock} tone="amber" label="Due tomorrow" value={dueTomorrow} />
      </div>

      {board.rows.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No active projects yet"
          description="Every project becomes a row on this board — create one to get started."
        />
      ) : (
        <section className="rounded-2xl border border-ink/8 bg-white/70 p-4 sm:p-5">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-ink">Project overview</h2>
            <p className="mt-0.5 text-sm text-ink/50">Track progress across all projects and design stages.</p>
          </div>

          <TaskBoard board={board} todayKey={today} tomorrowKey={tomorrow} />
        </section>
      )}

      {/* Three quarters to the week, a quarter to what is coming: the seven
          day columns have a width they cannot go under, and at two thirds
          Saturday fell off the end. */}
      <div className="grid gap-6 lg:grid-cols-4">
        <section className="rounded-2xl border border-ink/8 bg-white/70 p-4 sm:p-5 lg:col-span-3">
          <WeekView
            team={board.team}
            tasks={assigned}
            weekKeys={weekDayKeys(anchor)}
            todayKey={today}
            weekStart={weekStartKey(anchor)}
          />
        </section>

        <section className="rounded-2xl border border-ink/8 bg-white/70 p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-ink">Upcoming</h2>
          <p className="mt-0.5 text-xs text-ink/45">Deadlines coming up across all projects.</p>

          {upcoming.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-ink/12 px-3 py-6 text-center text-xs text-ink/40">
              Nothing with a deadline yet. Give the stages their lengths in Settings.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {upcoming.map((stage) => (
                <li
                  key={`${stage.projectId}:${stage.taskId}`}
                  className="flex items-start gap-2.5 rounded-xl border border-ink/8 bg-white/60 p-2.5"
                >
                  <StateBadge state={stage.state} />
                  <span className="min-w-0 flex-1">
                    {/* The step's name gets the whole line; the date sits under
                        it, beside the project, where it costs the name nothing. */}
                    <span className="block truncate text-sm font-medium text-ink">{stage.taskName}</span>
                    <span className="mt-0.5 flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-xs text-ink/45">{stage.projectName}</span>
                      <DueLabel due={stage.dueBy!} timezone={timezone} today={today} tomorrow={tomorrow} />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** When a stage is due, in the words you would say it: today, tomorrow, or the date. */
function DueLabel({
  due,
  timezone,
  today,
  tomorrow,
}: {
  due: Date;
  timezone: string;
  today: string;
  tomorrow: string;
}) {
  const day = dayKeyIn(timezone, due);
  const overdue = day < today;
  const label = day === today ? "Today" : day === tomorrow ? "Tomorrow" : formatDayIn(timezone, due);

  return (
    <span
      className={cn(
        "shrink-0 text-[11px] font-medium",
        overdue ? "text-pink-strong" : day === today || day === tomorrow ? "text-amber-700" : "text-ink/45"
      )}
    >
      {overdue ? `Late · ${formatDayIn(timezone, due)}` : label}
    </span>
  );
}

const STAT_TONES = {
  purple: "bg-purple/10 text-purple-strong",
  emerald: "bg-emerald-500/10 text-emerald-700",
  cyan: "bg-cyan/10 text-cyan-strong",
  amber: "bg-amber-500/10 text-amber-700",
} as const;

function Stat({
  icon: Icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: typeof Clock;
  tone: keyof typeof STAT_TONES;
  label: string;
  value: number;
  /** The denominator, where the number is part of something. */
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-ink/8 bg-white/70 p-3.5 sm:p-4">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", STAT_TONES[tone])}>
        <Icon size={18} strokeWidth={2} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-medium text-ink/45 sm:text-xs">{label}</span>
        <span className="block text-xl font-semibold tabular-nums text-ink sm:text-2xl">
          {value}
          {hint && <span className="ml-1 text-xs font-normal text-ink/35">{hint}</span>}
        </span>
      </span>
    </div>
  );
}
