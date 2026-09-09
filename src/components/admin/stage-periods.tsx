"use client";

import { useState, useTransition } from "react";
import { ArrowRight, CalendarRange, Layers, Plus, Timer, Trash2 } from "lucide-react";
import {
  createProcessSection,
  deleteProcessSection,
  deleteStagePeriod,
  moveProcessSection,
  saveStagePeriod,
  setTaskSection,
  updateProcessSection,
} from "@/lib/actions/task-actions";
import { periodTimeline, totalDays } from "@/lib/stage-schedule";
import { dotTone } from "@/lib/task-board";
import { cn } from "@/lib/utils";

// The shape of the process: which steps make up which section, and how long a
// run of steps is allowed to take.
//
// Periods are ranges on purpose. Nobody times a delivery process one box at a
// time — "site visit through BOQ is four days" is a single decision, and every
// step inside the range shares the deadline it produces. Ranges chain, so the
// whole process carries dates and no project ever needs one typed on it.

type Step = { id: string; name: string; sectionId: string | null };
type Section = { id: string; name: string; color: string };
type Period = { id: string; fromTaskId: string; toTaskId: string; days: number };

export function StagePeriods({
  steps,
  sections,
  periods,
}: {
  steps: Step[];
  sections: Section[];
  periods: Period[];
}) {
  const [pending, start] = useTransition();
  const nameOf = new Map(steps.map((step) => [step.id, step.name]));

  const timeline = periodTimeline(
    steps.map((step) => step.id),
    periods
  );
  const total = totalDays(periods);

  function run(action: () => Promise<unknown>) {
    start(async () => {
      await action();
    });
  }

  return (
    <div className={cn("flex flex-col gap-8", pending && "opacity-95")}>
      <SectionEditor sections={sections} steps={steps} run={run} />

      <section>
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <Timer size={15} strokeWidth={2} />
          Stage periods
        </h2>
        <p className="mt-1 text-sm text-ink/50">
          Pick the first and last step of a run and say how many days it gets — &ldquo;site visit through BOQ, four
          days&rdquo;. Every step inside the range shares that deadline, and the next range starts when this one is
          finished, so the employee sees a countdown instead of a date to remember.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-ink/8 bg-white/50 px-4 py-3">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
            <CalendarRange size={15} strokeWidth={1.75} />
            {total === 0 ? "Nothing timed yet" : `${total} days end to end`}
          </span>
          {periods.length > 0 && (
            <span className="text-xs text-ink/45">
              {periods.length} {periods.length === 1 ? "range" : "ranges"} · steps outside them run untimed.
            </span>
          )}
        </div>

        {periods.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {timeline.map(({ period, startDay, endDay, steps: count }) => {
              const row = periods.find(
                (candidate) =>
                  candidate.fromTaskId === period.fromTaskId && candidate.toTaskId === period.toTaskId
              );
              return (
                <li
                  key={`${period.fromTaskId}:${period.toTaskId}`}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-ink/8 bg-white/50 px-4 py-3"
                >
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-sm text-ink">
                    <span className="font-medium">{nameOf.get(period.fromTaskId) ?? "—"}</span>
                    <ArrowRight size={13} strokeWidth={2} className="text-ink/30" />
                    <span className="font-medium">{nameOf.get(period.toTaskId) ?? "—"}</span>
                    <span className="text-xs text-ink/40">
                      · {count} {count === 1 ? "step" : "steps"} · day {startDay}
                      {endDay > startDay ? `–${endDay}` : ""}
                    </span>
                  </span>

                  <span className="text-sm font-semibold tabular-nums text-ink">{period.days}d</span>

                  {row && (
                    <button
                      type="button"
                      onClick={() => run(() => deleteStagePeriod(row.id))}
                      aria-label="Remove this range"
                      className="rounded-md p-1.5 text-red-500/70 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 size={14} strokeWidth={1.75} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <PeriodForm steps={steps} />
      </section>
    </div>
  );
}

/** Adding a range, or changing the days on one that already exists. */
function PeriodForm({ steps }: { steps: Step[] }) {
  const [from, setFrom] = useState(steps[0]?.id ?? "");
  const [to, setTo] = useState(steps[0]?.id ?? "");
  const [days, setDays] = useState("2");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (steps.length === 0) {
    return (
      <p className="mt-4 rounded-xl border border-dashed border-ink/15 px-4 py-6 text-center text-sm text-ink/40">
        No process steps yet — add them on the Tasks board and they appear here.
      </p>
    );
  }

  return (
    <form
      action={() => {
        setError(null);
        const formData = new FormData();
        formData.set("fromTaskId", from);
        formData.set("toTaskId", to);
        formData.set("days", days);
        start(async () => {
          try {
            await saveStagePeriod(formData);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "That did not save.");
          }
        });
      }}
      className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-ink/15 bg-white/40 px-4 py-3"
    >
      <label className="min-w-40 flex-1">
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink/40">From</span>
        <select
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          className="w-full rounded-lg border border-ink/12 bg-white px-2 py-1.5 text-sm outline-none focus:border-cyan-strong"
        >
          {steps.map((step) => (
            <option key={step.id} value={step.id}>
              {step.name}
            </option>
          ))}
        </select>
      </label>

      <label className="min-w-40 flex-1">
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink/40">To</span>
        <select
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className="w-full rounded-lg border border-ink/12 bg-white px-2 py-1.5 text-sm outline-none focus:border-cyan-strong"
        >
          {steps.map((step) => (
            <option key={step.id} value={step.id}>
              {step.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink/40">Days</span>
        <input
          type="number"
          min="1"
          max="365"
          value={days}
          onChange={(event) => setDays(event.target.value)}
          className="w-20 rounded-lg border border-ink/12 bg-white px-2 py-1.5 text-sm outline-none focus:border-cyan-strong"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-bg disabled:opacity-60"
      >
        <Plus size={14} strokeWidth={2.25} />
        Set period
      </button>

      {error && <p className="w-full text-xs font-medium text-pink-strong">{error}</p>}
    </form>
  );
}

/** The sections themselves, and which steps sit in each. */
function SectionEditor({
  sections,
  steps,
  run,
}: {
  sections: Section[];
  steps: Step[];
  run: (action: () => Promise<unknown>) => void;
}) {
  const [adding, setAdding] = useState("");

  return (
    <section>
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
        <Layers size={15} strokeWidth={2} />
        Process sections
      </h2>
      <p className="mt-1 text-sm text-ink/50">
        The parts every project passes through — site &amp; procurement, 3D visualization, technical drawings. These
        group the board&apos;s columns, and they are what work is handed out in: a person takes a section of a project,
        not sixteen separate steps.
      </p>

      <ul className="mt-4 flex flex-col gap-2">
        {sections.map((section) => (
          <li key={section.id} className="rounded-xl border border-ink/8 bg-white/50 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", dotTone(section.color))} />
              <input
                defaultValue={section.name}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value && value !== section.name) {
                    run(() => updateProcessSection(section.id, value, section.color));
                  }
                }}
                className="min-w-40 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-ink outline-none hover:border-ink/12 focus:border-cyan-strong focus:bg-white"
              />
              <button
                type="button"
                onClick={() => run(() => moveProcessSection(section.id, "left"))}
                aria-label="Move up"
                className="rounded-md px-2 py-1 text-xs text-ink/40 hover:bg-ink/5 hover:text-ink"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => run(() => moveProcessSection(section.id, "right"))}
                aria-label="Move down"
                className="rounded-md px-2 py-1 text-xs text-ink/40 hover:bg-ink/5 hover:text-ink"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Remove the “${section.name}” section? Its steps stay on the board.`)) {
                    run(() => deleteProcessSection(section.id));
                  }
                }}
                aria-label={`Remove ${section.name}`}
                className="rounded-md p-1.5 text-red-500/70 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 size={14} strokeWidth={1.75} />
              </button>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {steps
                .filter((step) => step.sectionId === section.id)
                .map((step) => (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => run(() => setTaskSection(step.id, null))}
                    title="Take this step out of the section"
                    className="rounded-full border border-ink/10 bg-white px-2.5 py-1 text-xs text-ink/65 hover:border-red-200 hover:text-red-600"
                  >
                    {step.name}
                  </button>
                ))}
              {steps.filter((step) => step.sectionId === section.id).length === 0 && (
                <span className="text-xs text-ink/35">No steps yet — add one from the list below.</span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Steps that belong nowhere, and the one control that fixes that. */}
      {steps.some((step) => !step.sectionId) && (
        <div className="mt-3 rounded-xl border border-dashed border-ink/15 bg-white/40 px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ink/40">Not in a section yet</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {steps
              .filter((step) => !step.sectionId)
              .map((step) => (
                <span key={step.id} className="inline-flex items-center gap-1 rounded-full border border-ink/10 bg-white px-2 py-1">
                  <span className="text-xs text-ink/65">{step.name}</span>
                  <select
                    defaultValue=""
                    onChange={(event) => {
                      if (event.target.value) run(() => setTaskSection(step.id, event.target.value));
                    }}
                    aria-label={`Put ${step.name} in a section`}
                    className="rounded border-none bg-transparent text-[11px] text-ink/45 outline-none"
                  >
                    <option value="">move to…</option>
                    {sections.map((section) => (
                      <option key={section.id} value={section.id}>
                        {section.name}
                      </option>
                    ))}
                  </select>
                </span>
              ))}
          </div>
        </div>
      )}

      <form
        action={() => {
          const value = adding.trim();
          if (!value) return;
          setAdding("");
          run(() => createProcessSection(value));
        }}
        className="mt-3 flex flex-wrap items-end gap-2"
      >
        <input
          value={adding}
          onChange={(event) => setAdding(event.target.value)}
          placeholder="Site &amp; Procurement"
          aria-label="New section name"
          className="min-w-48 flex-1 rounded-lg border border-ink/12 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-strong"
        />
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm font-medium text-ink/70 hover:bg-white"
        >
          <Plus size={14} strokeWidth={2.25} />
          Add section
        </button>
      </form>
    </section>
  );
}
