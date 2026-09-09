import { CalendarRange, ClipboardList } from "lucide-react";
import type { AssignedTaskView } from "@/lib/assigned-tasks";
import { Countdown } from "@/components/employee/countdown";
import { dayKeyToDate } from "@/lib/time";
import { daysBetween, dayLabel } from "@/lib/week";
import { cn } from "@/lib/utils";

// A job the manager handed out directly — not a stage of any project, so it has
// no board cell and no photo to send. It has a span of days and a countdown,
// which is the part the employee acts on.

const PRIORITY_STYLE = {
  HIGH: "bg-pink/10 text-pink-strong border-pink/20",
  MEDIUM: "bg-orange/10 text-orange-strong border-orange/20",
  LOW: "bg-ink/5 text-ink/50 border-ink/10",
} as const;

export function AssignedTaskCard({ task }: { task: AssignedTaskView }) {
  const days = daysBetween(task.startKey, task.endKey) + 1;
  const from = dayLabel(task.startKey);
  const to = dayLabel(task.endKey);
  const done = task.state === "DONE";

  // The deadline is the end of the last day, not its start — a job due today
  // is not late at nine in the morning.
  const dueBy = new Date(dayKeyToDate(task.endKey).getTime() + 24 * 60 * 60 * 1000 - 1);

  return (
    <div className={cn("glass rounded-2xl p-4", done && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full border border-ink/10 bg-ink/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink/50">
          <ClipboardList size={10} strokeWidth={2.5} />
          From the manager
        </span>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            PRIORITY_STYLE[task.priority]
          )}
        >
          {task.priority}
        </span>
      </div>

      <h3 className={cn("mt-2 text-[15px] font-semibold text-ink", done && "line-through")}>{task.title}</h3>

      {task.note && <p className="mt-1.5 text-sm text-ink/60">{task.note}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ink/50">
          <CalendarRange size={12} strokeWidth={2} />
          {days === 1
            ? `${from.weekday} ${from.day} ${from.month}`
            : `${from.weekday} ${from.day} – ${to.weekday} ${to.day} ${to.month} · ${days} days`}
        </span>
        {!done && <Countdown dueBy={dueBy.toISOString()} />}
      </div>
    </div>
  );
}
