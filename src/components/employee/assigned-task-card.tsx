import Link from "next/link";
import { CalendarRange, ChevronRight, ClipboardList } from "lucide-react";
import type { AssignedTaskView } from "@/lib/assigned-tasks";
import { Countdown } from "@/components/employee/countdown";
import { DeadlineMeter } from "@/components/employee/deadline-meter";
import { STATE_STYLE } from "@/components/employee/task-card";
import { EMPLOYEE_STATE_LABEL } from "@/lib/task-board";
import { daysBetween, dayLabel } from "@/lib/week";
import { cn } from "@/lib/utils";

// A job the manager handed out directly — not a stage of any project, but it
// works the same way: tap it, set it going, send a photo when it is done. The
// badge is the only thing that says it came from somewhere else.
//
// Titles are often Arabic, so they read in their own direction rather than
// being forced left to right.

const PRIORITY_STYLE = {
  HIGH: "bg-pink/10 text-pink-strong border-pink/20",
  MEDIUM: "bg-orange/10 text-orange-strong border-orange/20",
  LOW: "bg-ink/5 text-ink/50 border-ink/10",
} as const;

export function AssignedTaskCard({ task, timezone }: { task: AssignedTaskView; timezone: string }) {
  const days = daysBetween(task.startKey, task.endKey) + 1;
  const from = dayLabel(task.startKey);
  const to = dayLabel(task.endKey);
  const done = task.state === "DONE";

  return (
    <Link
      href={`/employee/assigned/${task.id}`}
      className={cn(
        "glass block rounded-2xl p-3.5 transition-transform active:scale-[0.99]",
        done && "opacity-70"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full border border-ink/10 bg-ink/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink/50">
              <ClipboardList size={10} strokeWidth={2.5} />
              From the manager
            </span>
            {/* Only a high priority earns its own chip here too. */}
            {task.priority === "HIGH" && (
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  PRIORITY_STYLE.HIGH
                )}
              >
                High
              </span>
            )}
          </div>

          <h3 dir="auto" className={cn("text-[15px] font-semibold text-ink", done && "line-through")}>
            {task.title}
          </h3>

          {task.note && (
            <p dir="auto" className="mt-1.5 line-clamp-2 text-sm text-ink/60">
              {task.note}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", STATE_STYLE[task.state])}>
              {EMPLOYEE_STATE_LABEL[task.state]}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ink/50">
              <CalendarRange size={12} strokeWidth={2} />
              {days === 1
                ? `${from.weekday} ${from.day} ${from.month}`
                : `${from.weekday} ${from.day} – ${to.weekday} ${to.day} ${to.month}`}
            </span>
            {!done && <Countdown dueDay={task.endKey} timeZone={timezone} />}
          </div>

          {!done && (
            <DeadlineMeter startKey={task.startKey} endKey={task.endKey} timeZone={timezone} showLabel={false} />
          )}
        </div>

        <ChevronRight size={18} className="mt-1 shrink-0 text-ink/25" />
      </div>
    </Link>
  );
}
