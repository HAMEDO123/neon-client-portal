"use client";

import { useOptimistic, useTransition } from "react";
import { Circle, Loader } from "lucide-react";
import { setMyTaskStatus } from "@/lib/actions/employee-actions";
import type { TaskState } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

// The two statuses an employee owns.
//
// "Completed" is deliberately absent: an employee cannot declare their own work
// finished, they send a photo of it and the manager decides. The server rejects
// any other state regardless of what is rendered here.
const OPTIONS: { state: TaskState; label: string; icon: typeof Circle; active: string }[] = [
  { state: "TODO", label: "Pending", icon: Circle, active: "bg-ink text-bg border-ink" },
  { state: "IN_PROGRESS", label: "In Progress", icon: Loader, active: "bg-cyan-strong text-white border-cyan-strong" },
];

export function StatusControl({ entryId, state }: { entryId: string; state: TaskState }) {
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(state);

  // Once the photo is with the manager, the employee is no longer the one
  // moving this task around.
  const locked = shown === "SUBMITTED" || shown === "DONE";

  function choose(next: TaskState) {
    if (next === shown || locked) return;
    startTransition(async () => {
      setShown(next);
      await setMyTaskStatus(entryId, next);
    });
  }

  return (
    <div className={cn("grid grid-cols-2 gap-2", (pending || locked) && "opacity-70")}>
      {OPTIONS.map((option) => {
        const active = shown === option.state;
        return (
          <button
            key={option.state}
            type="button"
            onClick={() => choose(option.state)}
            disabled={locked}
            aria-pressed={active}
            className={cn(
              "flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border text-xs font-medium transition-colors",
              active ? option.active : "border-ink/12 bg-white/70 text-ink/55 hover:bg-white"
            )}
          >
            <option.icon size={18} strokeWidth={2} />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
