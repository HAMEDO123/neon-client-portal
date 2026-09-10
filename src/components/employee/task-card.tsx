import Link from "next/link";
import { CalendarClock, ChevronRight, Clock, Sparkles } from "lucide-react";
import type { EmployeeTask } from "@/lib/employee-tasks";
import { EMPLOYEE_STATE_LABEL } from "@/lib/task-board";
import { Countdown } from "@/components/employee/countdown";
import { formatTimeIn } from "@/lib/time";
import { cn } from "@/lib/utils";

const PRIORITY_STYLE = {
  HIGH: "bg-pink/10 text-pink-strong border-pink/20",
  MEDIUM: "bg-orange/10 text-orange-strong border-orange/20",
  LOW: "bg-ink/5 text-ink/50 border-ink/10",
} as const;

export const STATE_STYLE = {
  DONE: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  SUBMITTED: "bg-purple/10 text-purple-strong border-purple/20",
  IN_PROGRESS: "bg-cyan/10 text-cyan-strong border-cyan/20",
  TOMORROW: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  TODO: "bg-ink/5 text-ink/55 border-ink/10",
} as const;

/** A task was "updated" if the admin touched it after the employee last did. */
function recentlyUpdated(task: EmployeeTask) {
  const sixHours = 6 * 60 * 60 * 1000;
  return Date.now() - task.updatedAt.getTime() < sixHours && task.state !== "DONE";
}

export function TaskCard({
  task,
  timezone,
  dueBy,
}: {
  task: EmployeeTask;
  timezone: string;
  /** The stage deadline, explicit or worked out from the stage's period. */
  dueBy?: Date | null;
}) {
  const due = formatTimeIn(timezone, task.dueAt);
  const done = task.state === "DONE";

  return (
    <Link
      href={`/employee/tasks/${task.id}`}
      className={cn(
        "glass block rounded-2xl p-4 transition-transform active:scale-[0.99]",
        done && "opacity-70"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                PRIORITY_STYLE[task.priority]
              )}
            >
              {task.priority}
            </span>
            {recentlyUpdated(task) && (
              <span className="inline-flex items-center gap-1 rounded-full border border-purple/20 bg-purple/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-strong">
                <Sparkles size={10} strokeWidth={2.5} />
                Updated
              </span>
            )}
          </div>

          <h3 className={cn("mt-2 text-[15px] font-semibold text-ink", done && "line-through")}>
            {task.task.name}
          </h3>
          <p className="mt-0.5 truncate text-xs text-ink/50">{task.project.name}</p>

          {task.adminNote && <p className="mt-2 line-clamp-2 text-sm text-ink/60">{task.adminNote}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                STATE_STYLE[task.state]
              )}
            >
              {EMPLOYEE_STATE_LABEL[task.state]}
            </span>
            {/* Finished work has no time left to run. */}
            {dueBy && !done && <Countdown dueBy={dueBy.toISOString()} timeZone={timezone} />}
            {due && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ink/50">
                <Clock size={12} strokeWidth={2} />
                {due}
              </span>
            )}
            {!due && task.state === "TOMORROW" && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                <CalendarClock size={12} strokeWidth={2} />
                Tomorrow
              </span>
            )}
          </div>
        </div>

        <ChevronRight size={18} className="mt-1 shrink-0 text-ink/25" />
      </div>
    </Link>
  );
}
