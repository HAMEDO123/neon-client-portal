"use client";

import { useOptimistic, useTransition } from "react";
import { Check, Circle, Loader } from "lucide-react";
import { setMyTaskStatus } from "@/lib/actions/employee-actions";
import type { TaskState } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

// The three statuses an employee owns. Anything else on the task — who it
// belongs to, when it is due, what it says — is the admin's, and the server
// rejects an attempt to set any other state regardless of what is rendered.
const OPTIONS: { state: TaskState; label: string; icon: typeof Circle; active: string }[] = [
  { state: "TODO", label: "Pending", icon: Circle, active: "bg-ink text-bg border-ink" },
  { state: "IN_PROGRESS", label: "In Progress", icon: Loader, active: "bg-cyan-strong text-white border-cyan-strong" },
  { state: "DONE", label: "Completed", icon: Check, active: "bg-emerald-600 text-white border-emerald-600" },
];

export function StatusControl({ entryId, state }: { entryId: string; state: TaskState }) {
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(state);

  function choose(next: TaskState) {
    if (next === shown) return;
    startTransition(async () => {
      setShown(next);
      await setMyTaskStatus(entryId, next);
    });
  }

  return (
    <div className={cn("grid grid-cols-3 gap-2", pending && "opacity-90")}>
      {OPTIONS.map((option) => {
        const active = shown === option.state;
        return (
          <button
            key={option.state}
            type="button"
            onClick={() => choose(option.state)}
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
