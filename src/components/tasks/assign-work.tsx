"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { TaskDialog } from "@/components/admin/week-board";
import { TaskBriefing } from "@/components/tasks/task-briefing";

// Handing work out, for an employee the manager trusted with it — and only
// that: one button for the manager's own form, and the box that turns a
// spoken briefing into a list.
//
// Nothing about the work afterwards. From 2026-11-14 an assigner saw what
// they handed out today and where each stood, and from 2026-11-15 could edit
// it; on 2026-11-19 the owner took both back — "remove the ability of editing
// the tasks for sally", then "and also cant see the status of them just hands
// them". So there is no list here, and the phone's `me/assign/week` answers
// an assigner with none. The server refuses an edit too (`refuseAssigner`).
//
// The form is the manager's own dialog, imported rather than rebuilt: it is
// the one place "counts as done when" gets typed, and a second copy of it is a
// second place for that field to go missing from.

type Member = { id: string; name: string; color: string; role: string | null };

export function AssignWork({
  team,
  todayKey,
}: {
  team: Member[];
  todayKey: string;
}) {
  const [writing, setWriting] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => setWriting(true)}
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-ink text-sm font-semibold text-bg transition-opacity active:opacity-90"
      >
        <Plus size={18} strokeWidth={2.5} />
        Assign a task
      </button>

      {/* The same box the manager has: several people's work said in one go,
          checked as a list, then handed out. */}
      <TaskBriefing team={team} todayKey={todayKey} />

      {writing && (
        <TaskDialog
          team={team}
          task={null}
          initial={{ employeeId: team[0]?.id ?? "", dayKey: todayKey }}
          onClose={() => setWriting(false)}
        />
      )}
    </div>
  );
}
