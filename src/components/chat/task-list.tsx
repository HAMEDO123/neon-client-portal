"use client";

import Link from "next/link";
import { useState } from "react";
import { ClipboardList, MessageSquare } from "lucide-react";
import type { TaskListItem } from "@/lib/chat-task-store";
import { CARD_STATE_LABEL, dueDistance, dueLabel, isOverdue, overallState, progressOf } from "@/lib/chat-tasks";
import { useMinuteNow } from "@/lib/use-minute-now";
import { StateBadge } from "@/components/ui/state-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PersonAvatar } from "@/components/chat/person-avatar";
import { cn } from "@/lib/utils";

// Every task handed out in a chat, in one list: the manager's all of them, an
// employee's their own. Open work first, the soonest due on top, the late ones
// in red; tapping one opens its chat at the card.
//
// Two looks, one list, like the rest of the chat. Late stays red in both: it is
// a fact about the work, not a matter of palette.

export function TaskList({
  items,
  basePath,
  timeZone,
  initialNow,
  emptyText,
  variant = "phone",
}: {
  items: TaskListItem[];
  /** Where the conversations live: "/employee/chat" or "/admin/chat". */
  basePath: string;
  timeZone: string;
  initialNow: number;
  emptyText: string;
  /** "phone" is the portal's own list; "studio" is the manager's warm one. */
  variant?: "phone" | "studio";
}) {
  const now = useMinuteNow() ?? initialNow;
  const [filter, setFilter] = useState<"open" | "done">("open");
  const studio = variant === "studio";

  const open = items.filter((item) => !progressOf(item.assignments).complete);
  const done = items.filter((item) => progressOf(item.assignments).complete);
  const shown = filter === "open" ? open : done;

  if (items.length === 0) {
    return <EmptyState icon={ClipboardList} title="No tasks yet" description={emptyText} className="m-3" />;
  }

  return (
    <div>
      <div
        className={cn("flex gap-1.5 border-b px-3 py-2.5", studio ? "border-warm-line" : "border-ink/[0.06]")}
        role="group"
        aria-label="Show"
      >
        {(
          [
            ["open", "Open", open.length],
            ["done", "Done", done.length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2",
              studio ? "focus-visible:ring-clay/40" : "focus-visible:ring-cyan-strong/40",
              filter === key
                ? studio
                  ? "bg-bark text-paper"
                  : "bg-ink text-bg"
                : studio
                  ? "bg-clay-soft/60 text-bark/60 hover:bg-clay-soft"
                  : "bg-ink/[0.05] text-ink/60 hover:bg-ink/[0.09]"
            )}
          >
            {label}
            <span
              className={cn(
                "tabular-nums",
                filter === key ? (studio ? "text-paper/70" : "text-bg/70") : studio ? "text-bark/40" : "text-ink/40"
              )}
            >
              {count}
            </span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className={cn("px-4 py-8 text-center text-sm", studio ? "text-bark/45" : "text-ink/45")}>
          {filter === "open" ? "Nothing open. Every task is done." : "Nothing finished yet."}
        </p>
      ) : (
        <ul className={cn("flex flex-col divide-y", studio ? "divide-warm-line" : "divide-ink/6")}>
          {shown.map((item) => {
            const state = overallState(item.assignments);
            const progress = progressOf(item.assignments);
            const late = isOverdue(item.dueAt, item.assignments, now);

            return (
              <li key={item.id}>
                <Link
                  href={`${basePath}/${item.conversationSlug}?task=${item.id}`}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3 transition-colors focus-visible:outline-none",
                    studio
                      ? "hover:bg-clay-soft/40 focus-visible:bg-clay-soft/50"
                      : "hover:bg-ink/[0.03] focus-visible:bg-ink/[0.05]"
                  )}
                >
                  <StateBadge state={state} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p dir="auto" className={cn("truncate font-semibold", studio ? "text-bark" : "text-ink")}>
                        {item.title}
                      </p>
                      <span
                        className={cn(
                          "shrink-0 text-xs",
                          late ? "font-semibold text-red-600" : studio ? "text-bark/40" : "text-ink/40"
                        )}
                      >
                        {late ? "Overdue" : CARD_STATE_LABEL[state]}
                      </span>
                    </div>
                    <p className={cn("mt-0.5 truncate text-sm", studio ? "text-bark/50" : "text-ink/50")}>
                      {item.conversationTitle} ·{" "}
                      <span className={late ? "text-red-600" : undefined}>
                        {dueLabel(item.dueAt, now, timeZone)}
                        {!progress.complete && ` (${dueDistance(item.dueAt, now).text})`}
                      </span>
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="flex -space-x-1.5" aria-label={item.assignments.map((part) => part.employee.name).join(", ")}>
                        {item.assignments.slice(0, 4).map((part) => (
                          <PersonAvatar
                            key={part.id}
                            name={part.employee.name}
                            color={part.employee.color}
                            size={20}
                            className={studio ? "ring-2 ring-card" : "ring-2 ring-white"}
                          />
                        ))}
                      </span>
                      {item.assignments.length > 4 && (
                        <span className={cn("text-xs", studio ? "text-bark/40" : "text-ink/40")}>
                          +{item.assignments.length - 4}
                        </span>
                      )}
                      <span className={cn("text-xs tabular-nums", studio ? "text-bark/45" : "text-ink/45")}>
                        {progress.done}/{progress.total} done
                      </span>
                      {item._count.comments > 0 && (
                        <span
                          className={cn("inline-flex items-center gap-1 text-xs", studio ? "text-bark/40" : "text-ink/40")}
                        >
                          <MessageSquare size={12} aria-hidden />
                          <span className="sr-only">Comments:</span>
                          {item._count.comments}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
