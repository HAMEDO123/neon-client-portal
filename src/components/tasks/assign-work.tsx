"use client";

import { useState } from "react";
import { CalendarDays, Plus } from "lucide-react";
import { TaskDialog } from "@/components/admin/week-board";
import { TaskBriefing } from "@/components/tasks/task-briefing";
import type { AssignedTaskView } from "@/lib/assigned-tasks";
import { StateBadge } from "@/components/ui/state-badge";
import { PRIORITY_ROW } from "@/components/tasks/priority";
import { STATE_LABEL } from "@/lib/task-board";
import { isLate } from "@/lib/task-filters";
import { cn } from "@/lib/utils";

// Handing work out, for an employee the manager trusted with it.
//
// Two halves. The top is giving work: one button for the manager's own form,
// and the box that turns a spoken briefing into a list. The bottom is watching
// it: what this person handed out today, under the name of whoever got it.
//
// Watching only. The studio's rule (2026-11-14): an assigner sees what they
// assigned "but still can't accept or reject, just see". So the rows here are
// not buttons — there is no dialog to open on one, no done tick, no delete —
// and the server refuses all of those to an assigner in any case
// (`refuseAssigner`, actions/assigned-task-actions.ts). The manager's Tasks
// page is where a job is changed, accepted or sent back.
//
// The form is the manager's own dialog, imported rather than rebuilt: it is
// the one place "counts as done when" gets typed, and a second copy of it is a
// second place for that field to go missing from.

type Member = { id: string; name: string; color: string; role: string | null };

export function AssignWork({
  team,
  tasks,
  todayKey,
}: {
  team: Member[];
  /** What this person handed out that runs today, or that they gave today. */
  tasks: AssignedTaskView[];
  todayKey: string;
}) {
  const [writing, setWriting] = useState(false);

  // In the team's own order, and only the people who got something.
  const groups = team
    .map((member) => ({ member, jobs: tasks.filter((task) => task.employeeId === member.id) }))
    .filter((group) => group.jobs.length > 0);
  // Somebody switched off since keeps their jobs on the list, under no colour.
  const known = new Set(team.map((member) => member.id));
  const others = tasks.filter((task) => !known.has(task.employeeId));

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => setWriting(true)}
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-ink text-sm font-semibold text-bg transition-opacity active:opacity-90"
      >
        <Plus size={18} strokeWidth={2.5} />
        Assign a task
      </button>

      {/* The same box the manager has: several people's work said in one go,
          checked as a list, then handed out. */}
      <TaskBriefing team={team} todayKey={todayKey} />

      <div>
        <h2 className="text-sm font-semibold text-ink">Assigned by you today</h2>
        <p className="mt-0.5 text-xs text-ink/45">
          Where each one stands. The manager reviews the work and marks it done.
        </p>
      </div>

      {tasks.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-ink/12 px-4 py-10 text-center text-sm text-ink/40">
          Nothing handed out by you today yet.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map(({ member, jobs }) => (
            <Person key={member.id} name={member.name} color={member.color} jobs={jobs} todayKey={todayKey} />
          ))}
          {others.length > 0 && <Person name="No longer on the team" color={null} jobs={others} todayKey={todayKey} />}
        </div>
      )}

      {writing && (
        <TaskDialog
          team={team}
          task={null}
          initial={{ employeeId: team[0]?.id ?? "", dayKey: todayKey }}
          onClose={() => setWriting(false)}
          // Only shown on an existing job, which this screen never opens.
          onDelete={() => {}}
          onToggleDone={() => {}}
        />
      )}
    </div>
  );
}

function Person({
  name,
  color,
  jobs,
  todayKey,
}: {
  name: string;
  color: string | null;
  jobs: AssignedTaskView[];
  todayKey: string;
}) {
  const done = jobs.filter((job) => job.state === "DONE").length;

  return (
    <section className="glass rounded-2xl p-3">
      <header className="mb-2 flex items-center gap-2 px-1">
        <span
          aria-hidden
          className="h-2.5 w-2.5 shrink-0 rounded-full bg-ink/20"
          style={color ? { backgroundColor: color } : undefined}
        />
        <h3 dir="auto" className="mr-auto text-sm font-semibold text-ink">
          {name}
        </h3>
        <span className="text-xs tabular-nums text-ink/45">
          {done}/{jobs.length} done
        </span>
      </header>

      <ul className="flex flex-col gap-1.5">
        {jobs.map((job) => {
          const late = isLate(job.state, job.endKey, todayKey);
          return (
            <li
              key={job.id}
              className={cn(
                "flex items-start gap-3 rounded-xl border p-2.5",
                PRIORITY_ROW[job.state === "DONE" ? "MEDIUM" : job.priority]
              )}
            >
              <StateBadge state={job.state} />
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block text-sm font-medium text-ink">
                  {job.title}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink/50">
                  <span className={cn(job.state === "SUBMITTED" && "font-medium text-purple-strong")}>
                    {STATE_LABEL[job.state]}
                  </span>
                  {late && <span className="font-medium text-pink-strong">Late</span>}
                  {/* Only when it is not simply today's: tomorrow's job given
                      this morning should say so. */}
                  {(job.startKey !== todayKey || job.endKey !== todayKey) && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays size={12} strokeWidth={1.75} />
                      {spanLabel(job, todayKey)}
                    </span>
                  )}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "Today", "Today → Thu", or the two dates — whichever is shortest to read. */
function spanLabel(task: AssignedTaskView, todayKey: string): string {
  const from = task.startKey === todayKey ? "Today" : shortDay(task.startKey);
  if (task.endKey === task.startKey) return from;
  return `${from} → ${shortDay(task.endKey)}`;
}

function shortDay(dayKey: string): string {
  // The key is already the company's own day; parsed as UTC so the label
  // cannot slip a day on a machine set to somewhere else.
  const at = new Date(`${dayKey}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(at);
}
