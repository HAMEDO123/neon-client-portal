import Link from "next/link";
import { dayLabel } from "@/lib/week";
import type { AssignedTaskView } from "@/lib/assigned-tasks";
import { cn } from "@/lib/utils";

// The Tasks list as a column on a desk (the new UI, "list and detail side by
// side", 2026-11-18): each job a row, grouped by what is next to do about it,
// and tapping one opens it in the panel beside the list (`?open=<id>`) instead
// of leaving the list. A phone keeps the cards, which open a page of their own.

type Row = { task: AssignedTaskView; late: boolean };

// Today first, always — asked for the day this shipped ("خلي التاسكات تاعون
// اليوم دايما اول اشي"): a long late list above them pushed today's work off
// the screen. Same order as the phone's cards (`dueBand`).
const GROUPS = [
  { key: "today", label: "Today" },
  { key: "late", label: "Late" },
  { key: "coming", label: "Coming up" },
  { key: "review", label: "Waiting for review" },
  { key: "done", label: "Done" },
] as const;

type GroupKey = (typeof GROUPS)[number]["key"];

/** Which heading a job sits under: what is next to do about it. */
export function groupOf(row: Row, todayKey: string): GroupKey {
  if (row.task.state === "DONE") return "done";
  if (row.task.state === "SUBMITTED") return "review";
  if (row.late) return "late";
  if (row.task.endKey <= todayKey || row.task.startKey <= todayKey) return "today";
  return "coming";
}

const DOT = { HIGH: "bg-red-500", MEDIUM: "bg-amber-500", LOW: "bg-ink/25" } as const;

function when(task: AssignedTaskView, todayKey: string, late: boolean) {
  const day = dayLabel(task.endKey);
  if (task.state === "DONE") return "Approved";
  if (task.state === "SUBMITTED") return "Sent for review";
  if (late) return `Late · was due ${day.weekday} ${day.day} ${day.month}`;
  if (task.endKey === todayKey) return "Due today";
  return `Due ${day.weekday} ${day.day} ${day.month}`;
}

export function TaskListPane({
  rows,
  todayKey,
  openId,
  hrefFor,
}: {
  rows: Row[];
  todayKey: string;
  openId: string | null;
  hrefFor: (id: string) => string;
}) {
  return (
    <nav
      aria-label="Your tasks"
      className="glass flex flex-col rounded-2xl p-2 lg:sticky lg:top-4 lg:max-h-[calc(var(--app-height)-2rem)] lg:overflow-y-auto"
    >
      {GROUPS.map((group) => {
        const inGroup = rows.filter((row) => groupOf(row, todayKey) === group.key);
        if (inGroup.length === 0) return null;
        return (
          <div key={group.key} className="flex flex-col">
            <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">
              {group.label} · {inGroup.length}
            </p>
            {inGroup.map(({ task, late }) => {
              const open = task.id === openId;
              return (
                <Link
                  key={task.id}
                  href={hrefFor(task.id)}
                  scroll={false}
                  aria-current={open ? "true" : undefined}
                  className={cn(
                    "flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors",
                    open ? "bg-clay-soft" : "hover:bg-ink/[0.04]"
                  )}
                >
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", DOT[task.priority])} aria-hidden />
                  <span className="min-w-0 flex-1">
                    {/* Work under way lit up in the In Progress button's own
                        blue — asked for the day this shipped, so what you are
                        on stands out from what you have not started. */}
                    <span
                      dir="auto"
                      className={cn(
                        "block truncate text-sm font-semibold",
                        task.state === "IN_PROGRESS" ? "text-cyan-strong" : "text-ink"
                      )}
                    >
                      {task.title}
                    </span>
                    <span className={cn("block text-xs", late ? "font-medium text-red-700" : "text-ink/50")}>
                      {task.state === "IN_PROGRESS" ? "In progress · " : ""}
                      {when(task, todayKey, late)}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
