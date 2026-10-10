"use client";

import { chipClass, chipCountClass } from "@/components/tasks/filter-chip";
import type { TaskFilter } from "@/lib/task-filters";
import { cn } from "@/lib/utils";

// The row of buttons that narrows a list of tasks to one kind — in progress,
// sent for review, late, done — each with how many there are, so "is anything
// late" is answered before anything is pressed.
//
// For the screens that hold their tasks in the browser (the manager's week,
// the Assign view). The team's own list filters on the server and draws the
// same row as links.

export function TaskFilterBar({
  options,
  active,
  counts,
  onPick,
  className,
}: {
  options: readonly { key: TaskFilter; label: string }[];
  active: TaskFilter;
  counts: Record<TaskFilter, number>;
  onPick: (filter: TaskFilter) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)} role="group" aria-label="Show">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={option.key === active}
          onClick={() => onPick(option.key)}
          className={chipClass(option.key, active, counts[option.key])}
        >
          {option.label}
          <span className={chipCountClass(option.key, active)}>{counts[option.key]}</span>
        </button>
      ))}
    </div>
  );
}
