import type { TaskFilter } from "@/lib/task-filters";
import { cn } from "@/lib/utils";

// How one button in a row of task filters looks. A plain module, not a client
// one: the team's own list draws these as links on the server, and a function
// exported from a "use client" file cannot be called there.

const CHIP = {
  base: "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
  on: "border-ink bg-ink text-bg",
  off: "border-ink/12 bg-white/60 text-ink/60 hover:bg-white",
  // Something is late: the one button that should be seen without looking for it.
  alarm: "border-red-500/35 bg-red-500/10 text-red-700 hover:bg-red-500/15",
} as const;

export function chipClass(filter: TaskFilter, active: TaskFilter, count: number) {
  return cn(CHIP.base, filter === active ? CHIP.on : filter === "late" && count > 0 ? CHIP.alarm : CHIP.off);
}

/** The number beside the label. */
export function chipCountClass(filter: TaskFilter, active: TaskFilter) {
  return cn("text-xs tabular-nums", filter === active ? "text-bg/60" : "opacity-60");
}
