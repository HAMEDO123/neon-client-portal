"use client";

import { useState } from "react";
import { CalendarClock, EyeOff, StickyNote, X } from "lucide-react";
import { updateTaskEntryDetails } from "@/lib/actions/task-detail-actions";
import { PRIORITY_LABEL } from "@/lib/task-board";
import { cn } from "@/lib/utils";

// Scheduling for one board cell: who does it, on which day, by when, how
// urgent, and anything they need to know. Saving hands the change to the
// notification engine — the admin never sends a notification by hand.

export type CellDetails = {
  priority: "LOW" | "MEDIUM" | "HIGH";
  scheduledFor: string | null;
  dueAt: string | null;
  adminNote: string | null;
  assigneeId: string | null;
  excludedFromProgress: boolean;
};

export function TaskScheduleEditor({
  projectId,
  projectName,
  taskId,
  taskName,
  details,
  owners,
  defaultOwnerId,
  todayKey,
  tomorrowKey,
  onClose,
  onSaved,
}: {
  projectId: string;
  projectName: string;
  taskId: string;
  taskName: string;
  details: CellDetails;
  owners: { id: string; name: string }[];
  defaultOwnerId: string | null;
  todayKey: string;
  tomorrowKey: string;
  onClose: () => void;
  /** Lets the board show the change straight away, before the server answers. */
  onSaved?: (details: CellDetails) => void;
}) {
  const [scheduled, setScheduled] = useState(details.scheduledFor ?? "");
  const [excluded, setExcluded] = useState(details.excludedFromProgress);
  const [pending, setPending] = useState(false);

  // The stored deadline is an instant; the input wants local wall-clock time.
  const dueTime = details.dueAt
    ? new Date(details.dueAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <form
      action={async (formData) => {
        setPending(true);

        // Paint the cell before the round trip: the marker appears the moment
        // Save is pressed rather than after the board has been re-fetched.
        const dueTime = String(formData.get("dueTime") ?? "").trim();
        onSaved?.({
          priority: (formData.get("priority") as CellDetails["priority"]) ?? "MEDIUM",
          scheduledFor: scheduled || null,
          dueAt: scheduled && dueTime ? `${scheduled}T${dueTime}` : null,
          adminNote: String(formData.get("adminNote") ?? "").trim() || null,
          assigneeId: String(formData.get("assigneeId") ?? "") || null,
          excludedFromProgress: formData.get("excludedFromProgress") === "on",
        });

        try {
          await updateTaskEntryDetails(projectId, taskId, formData);
          onClose();
        } finally {
          setPending(false);
        }
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{taskName}</p>
          <p className="truncate text-xs text-ink/45">{projectName}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-ink/30 hover:bg-ink/5 hover:text-ink"
        >
          <X size={13} strokeWidth={2} />
        </button>
      </div>

      <label className="block">
        <span className="block text-[11px] font-medium uppercase tracking-wider text-ink/40">Assigned to</span>
        <select
          name="assigneeId"
          defaultValue={details.assigneeId ?? ""}
          className="mt-1 w-full rounded-lg border border-ink/12 bg-white px-2 py-1.5 text-sm outline-none focus:border-cyan-strong"
        >
          <option value="">
            {defaultOwnerId
              ? `Step owner (${owners.find((o) => o.id === defaultOwnerId)?.name ?? "unassigned"})`
              : "Unassigned"}
          </option>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.name}
            </option>
          ))}
        </select>
      </label>

      <div>
        <span className="block text-[11px] font-medium uppercase tracking-wider text-ink/40">Scheduled for</span>
        <div className="mt-1 flex gap-1.5">
          <QuickDay label="Today" value={todayKey} active={scheduled === todayKey} onPick={setScheduled} />
          <QuickDay label="Tomorrow" value={tomorrowKey} active={scheduled === tomorrowKey} onPick={setScheduled} />
          {scheduled && (
            <button
              type="button"
              onClick={() => setScheduled("")}
              className="rounded-lg border border-ink/12 px-2 py-1.5 text-xs text-ink/45 hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>
        <input
          type="date"
          name="scheduledFor"
          value={scheduled}
          onChange={(e) => setScheduled(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-ink/12 bg-white px-2 py-1.5 text-sm outline-none focus:border-cyan-strong"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-ink/40">Due time</span>
          <input
            type="time"
            name="dueTime"
            defaultValue={dueTime}
            disabled={!scheduled}
            className="mt-1 w-full rounded-lg border border-ink/12 bg-white px-2 py-1.5 text-sm outline-none focus:border-cyan-strong disabled:opacity-40"
          />
        </label>

        <label className="block">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-ink/40">Priority</span>
          <select
            name="priority"
            defaultValue={details.priority}
            className="mt-1 w-full rounded-lg border border-ink/12 bg-white px-2 py-1.5 text-sm outline-none focus:border-cyan-strong"
          >
            {(["LOW", "MEDIUM", "HIGH"] as const).map((value) => (
              <option key={value} value={value}>
                {PRIORITY_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink/40">
          <StickyNote size={11} strokeWidth={2} />
          Note for the employee
        </span>
        <textarea
          name="adminNote"
          rows={2}
          defaultValue={details.adminNote ?? ""}
          placeholder="Anything they need to know…"
          className="mt-1 w-full rounded-lg border border-ink/12 bg-white px-2 py-1.5 text-sm outline-none focus:border-cyan-strong"
        />
      </label>

      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-ink/10 bg-white/60 px-2 py-1.5">
        <input
          type="checkbox"
          name="excludedFromProgress"
          checked={excluded}
          onChange={(e) => setExcluded(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 accent-ink"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink/45">
            <EyeOff size={11} strokeWidth={2} />
            Not counted
          </span>
          <span className="mt-0.5 block text-[10px] leading-tight text-ink/40">
            Leaves this step out of the employee&apos;s progress percentage. It stays on the board.
          </span>
        </span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-ink text-xs font-medium text-bg disabled:opacity-60"
      >
        <CalendarClock size={13} strokeWidth={2} />
        {pending ? "Saving…" : "Save & notify"}
      </button>

      <p className="text-[10px] leading-tight text-ink/35">
        The assigned employee is notified automatically — in the app and, if they have it on, on their devices.
      </p>
    </form>
  );
}

function QuickDay({
  label,
  value,
  active,
  onPick,
}: {
  label: string;
  value: string;
  active: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(value)}
      className={cn(
        "flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors",
        active ? "border-ink bg-ink text-bg" : "border-ink/12 bg-white text-ink/60 hover:text-ink"
      )}
    >
      {label}
    </button>
  );
}
