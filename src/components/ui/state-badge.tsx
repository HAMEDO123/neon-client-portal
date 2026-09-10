import { CalendarClock, Camera, Check, Loader } from "lucide-react";
import type { TaskState } from "@/generated/prisma/enums";
import { LiveDot } from "@/components/ui/live-dot";
import { cn } from "@/lib/utils";

// The mark for where a task stands, the same everywhere a task appears: the
// board's cells, its legend, and the jobs in the week table. One look per
// state, so "being worked on" is recognisable wherever it turns up.

const TONE: Record<TaskState, string> = {
  DONE: "border-emerald-500/30 bg-emerald-500/15 text-emerald-700",
  IN_PROGRESS: "border-cyan/40 bg-cyan/15 text-cyan-strong",
  // Waiting on the manager: it looks unlike anything they set themselves.
  SUBMITTED: "border-purple/40 bg-purple/15 text-purple-strong",
  TOMORROW: "border-amber-500/30 bg-amber-500/15 text-amber-700",
  TODO: "border-ink/15 bg-white/70",
};

const SIZE = {
  cell: { box: "h-6 w-6 rounded-md", icon: 13 },
  bar: { box: "h-4 w-4 rounded", icon: 10 },
  legend: { box: "h-4 w-4 rounded", icon: 9 },
} as const;

export function StateBadge({
  state,
  size = "cell",
  className,
}: {
  state: TaskState;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const { box, icon } = SIZE[size];

  return (
    <span
      aria-hidden
      className={cn("relative flex shrink-0 items-center justify-center border transition-colors", box, TONE[state], className)}
    >
      {state === "DONE" && <Check size={icon + 1} strokeWidth={3} />}
      {state === "IN_PROGRESS" && <Loader size={icon} strokeWidth={2.5} />}
      {state === "SUBMITTED" && <Camera size={icon} strokeWidth={2.25} />}
      {state === "TOMORROW" && <CalendarClock size={icon} strokeWidth={2.25} />}
      {/* Happening now: the live light, on the work itself but not in the key. */}
      {state === "IN_PROGRESS" && size !== "legend" && <LiveDot size="sm" className="absolute -right-1 -top-1" />}
    </span>
  );
}
