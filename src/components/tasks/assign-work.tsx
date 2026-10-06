"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Plus } from "lucide-react";
import { TaskDialog } from "@/components/admin/week-board";
import { TaskBriefing } from "@/components/tasks/task-briefing";
import { deleteAssignedTask, setAssignedTaskState } from "@/lib/actions/assigned-task-actions";
import type { AssignedTaskView } from "@/lib/assigned-tasks";
import { StateBadge } from "@/components/ui/state-badge";
import { cn } from "@/lib/utils";

// Handing work out, without the board.
//
// The manager's Tasks page is two wide tables — a project-by-step matrix and a
// seven-day grid — and both are read on a desk. This is the same job on a
// phone: one button, and the form asking who it is for and what it is. The
// tables are not shrunk down here, they are simply not part of this screen.
//
// The form itself is the manager's own dialog, imported rather than rebuilt.
// It is the one place "counts as done when" gets typed, and a job without it
// comes back from the review queue saying there was nothing to check it
// against — so a second copy of this form is a second place for that field to
// go missing from.

type Member = { id: string; name: string; color: string; role: string | null };

export function AssignWork({
  team,
  tasks,
  todayKey,
  weekLabel,
  previousWeek,
  nextWeek,
  thisWeek,
  isThisWeek,
}: {
  team: Member[];
  tasks: AssignedTaskView[];
  todayKey: string;
  weekLabel: string;
  previousWeek: string;
  nextWeek: string;
  thisWeek: string;
  isThisWeek: boolean;
}) {
  // null = closed. { task: null } = writing a new one.
  const [dialog, setDialog] = useState<{ task: AssignedTaskView | null } | null>(null);
  const [pending, start] = useTransition();

  const byPerson = new Map(team.map((member) => [member.id, member]));

  return (
    <div className={cn("flex flex-col gap-4", pending && "opacity-95")}>
      <button
        type="button"
        onClick={() => setDialog({ task: null })}
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-ink text-sm font-semibold text-bg transition-opacity active:opacity-90"
      >
        <Plus size={18} strokeWidth={2.5} />
        Assign a task
      </button>

      {/* The same box the manager has: several people's work said in one go,
          checked as a list, then handed out. It has no wide table in it, so it
          belongs on a phone as much as on a desk. */}
      <TaskBriefing team={team} todayKey={todayKey} />

      <div className="flex items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold text-ink">{weekLabel}</h2>
        <WeekStep href={previousWeek} label="Previous week">
          <ChevronLeft size={15} strokeWidth={2} />
        </WeekStep>
        {!isThisWeek && (
          <Link
            href={thisWeek}
            className="rounded-lg border border-ink/12 bg-white/70 px-2.5 py-1.5 text-xs font-medium text-ink/60"
          >
            This week
          </Link>
        )}
        <WeekStep href={nextWeek} label="Next week">
          <ChevronRight size={15} strokeWidth={2} />
        </WeekStep>
      </div>

      {tasks.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-ink/12 px-4 py-10 text-center text-sm text-ink/40">
          Nothing handed out this week yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tasks.map((task) => {
            const person = byPerson.get(task.employeeId);
            return (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => setDialog({ task })}
                  className="flex w-full items-start gap-3 rounded-2xl border border-ink/8 bg-white/70 p-3 text-left transition-colors active:bg-white"
                >
                  <StateBadge state={task.state} />
                  <span className="min-w-0 flex-1">
                    <span dir="auto" className="block text-sm font-medium text-ink">
                      {task.title}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink/45">
                      <span className="inline-flex items-center gap-1">
                        <ClipboardList size={12} strokeWidth={1.75} />
                        {person?.name ?? "Somebody"}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays size={12} strokeWidth={1.75} />
                        {spanLabel(task, todayKey)}
                      </span>
                      {/* The field that decides whether the photo they send
                          can be checked at all. Said on the card, because the
                          moment to fix it is before the work starts. */}
                      {!task.acceptance && <span className="text-amber-700">No “done when”</span>}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {dialog && (
        <TaskDialog
          team={team}
          task={dialog.task}
          initial={dialog.task ? null : { employeeId: team[0]?.id ?? "", dayKey: todayKey }}
          onClose={() => setDialog(null)}
          onDelete={(id) => {
            setDialog(null);
            start(async () => {
              await deleteAssignedTask(id);
            });
          }}
          onToggleDone={(task) => {
            setDialog(null);
            start(async () => {
              await setAssignedTaskState(task.id, task.state === "DONE" ? "TODO" : "DONE");
            });
          }}
        />
      )}
    </div>
  );
}

function WeekStep({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="rounded-lg border border-ink/12 bg-white/70 p-1.5 text-ink/60"
      scroll={false}
    >
      {children}
    </Link>
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
