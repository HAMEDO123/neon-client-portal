"use client";

import { useTransition } from "react";
import { saveNotificationPreferences } from "@/lib/actions/employee-actions";
import type { PreferenceFlags } from "@/lib/notifications/types";
import { cn } from "@/lib/utils";

// Granular switches the engine consults before it sends anything. Saving
// submits the whole form, so an unchecked box is genuinely "off" rather than
// absent.
const SWITCHES: { name: keyof PreferenceFlags; label: string; hint: string }[] = [
  { name: "taskAssigned", label: "Task assigned", hint: "When an admin gives you a new task" },
  { name: "taskUpdated", label: "Task updated", hint: "When one of your tasks changes" },
  { name: "todaySchedule", label: "Today's schedule", hint: "A morning summary of today's work" },
  { name: "tomorrowSchedule", label: "Tomorrow's schedule", hint: "The 4:00 PM summary of tomorrow" },
  { name: "deadlineReminders", label: "Deadline reminders", hint: "Before a task with a deadline is due" },
];

export function PreferencesForm({ preferences }: { preferences: PreferenceFlags }) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => startTransition(() => saveNotificationPreferences(formData))}
      className="glass flex flex-col gap-1 rounded-2xl p-4"
    >
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink/40">What to notify me about</h2>

      {/* Push is the master switch: with it off, the engine still records
          notifications in the app but sends nothing to devices. */}
      <Row
        name="pushEnabled"
        label="Send to my devices"
        hint="Turn off to keep notifications in-app only"
        defaultChecked={preferences.pushEnabled}
      />

      <div className="my-2 h-px bg-ink/8" />

      {SWITCHES.map((option) => (
        <Row
          key={option.name}
          name={option.name}
          label={option.label}
          hint={option.hint}
          defaultChecked={Boolean(preferences[option.name])}
        />
      ))}

      <label className="mt-3 flex items-center justify-between gap-4 py-2">
        <span>
          <span className="block text-sm font-medium text-ink">Remind me before a deadline</span>
          <span className="block text-xs text-ink/45">Minutes ahead of the due time</span>
        </span>
        <input
          type="number"
          name="deadlineLeadMinutes"
          min={5}
          max={1440}
          step={5}
          defaultValue={preferences.deadlineLeadMinutes}
          className="w-20 rounded-lg border border-ink/12 bg-white/70 px-2 py-1.5 text-center text-sm outline-none focus:border-cyan-strong"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className={cn(
          "mt-4 h-11 rounded-full bg-ink text-sm font-medium text-bg transition-opacity",
          pending && "opacity-60"
        )}
      >
        {pending ? "Saving…" : "Save preferences"}
      </button>
    </form>
  );
}

function Row({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-4 py-2.5">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="block text-xs text-ink/45">{hint}</span>
      </span>
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-6 w-6 shrink-0 accent-[var(--cyan-strong)]"
      />
    </label>
  );
}
