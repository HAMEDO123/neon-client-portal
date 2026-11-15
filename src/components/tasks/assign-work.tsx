"use client";

import { useState } from "react";
import { CalendarDays, Pencil, Plus } from "lucide-react";
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
// Watching, and correcting what they wrote. The studio's rule (2026-11-14): an
// assigner sees what they assigned "but still can't accept or reject, just
// see" — and on 2026-11-15, "خليها تقدر تعدلهم": she may edit her own. So a row
// that is still open opens the same form to fix its wording, person or days,
// with no delete and no done tick on it. Every job on this list is one this
// person handed out (`assignedByToday`); the server checks that again, and
// refuses an approved job, a site visit, and everything past editing
// (`refuseUnlessOwnOpenJob`, `refuseAssigner`). The manager's Tasks page is
// where a job is deleted, accepted or sent back.
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
  const [editing, setEditing] = useState<AssignedTaskView | null>(null);

  // In the team's own order, and only the people who got something.
  const groups = team
    .map((member) => ({
      member,
      jobs: tasks.filter((task) => task.employeeId === member.id),
    }))
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
          Where each one stands — tap one to edit it. The manager reviews the work and marks it done.
        </p>
      </div>

      {tasks.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-ink/12 px-4 py-10 text-center text-sm text-ink/40">
          Nothing handed out by you today yet.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map(({ member, jobs }) => (
            <Person
              key={member.id}
              name={member.name}
              color={member.color}
              jobs={jobs}
              todayKey={todayKey}
              onEdit={setEditing}
            />
          ))}
          {/* Not editable: the form's "For" list has nobody to show for them,
              and would quietly hand the job to whoever is first on it. */}
          {others.length > 0 && <Person name="No longer on the team" color={null} jobs={others} todayKey={todayKey} />}
        </div>
      )}

      {writing && (
        <TaskDialog
          team={team}
          task={null}
          initial={{ employeeId: team[0]?.id ?? "", dayKey: todayKey }}
          onClose={() => setWriting(false)}
        />
      )}

      {/* No onDelete, no onToggleDone: the form shows neither button. */}
      {editing && <TaskDialog team={team} task={editing} initial={null} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Person({
  name,
  color,
  jobs,
  todayKey,
  onEdit,
}: {
  name: string;
  color: string | null;
  jobs: AssignedTaskView[];
  todayKey: string;
  onEdit?: (job: AssignedTaskView) => void;
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
          // Approved work is closed, and a site visit is changed on the visit.
          const editable = onEdit != null && job.state !== "DONE" && !job.siteVisitId;
          return (
            <li key={job.id}>
              <button
                type="button"
                disabled={!editable}
                onClick={() => onEdit?.(job)}
                aria-label={editable ? `Edit ${job.title}` : undefined}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl border p-2.5 text-left transition-colors",
                  PRIORITY_ROW[job.state === "DONE" ? "MEDIUM" : job.priority],
                  editable ? "cursor-pointer hover:border-ink/25 active:opacity-80" : "cursor-default"
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
                {editable && <Pencil size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink/30" />}
              </button>
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
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  }).format(at);
}
