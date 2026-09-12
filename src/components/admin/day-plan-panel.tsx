"use client";

import { useState, useTransition } from "react";
import { CalendarRange, Sparkles } from "lucide-react";
import { applyDayPlan, planEmployeeDay, saveDayPlanEdits } from "@/lib/actions/day-plan-actions";
import type { PlannedBlock } from "@/lib/day-plan";
import type { StoredDayPlan } from "@/lib/day-plan-store";
import { buttonClasses } from "@/components/ui/buttons";
import { cn } from "@/lib/utils";

// A proposed day for one person: generated, kept, edited, and only then put on
// the board. Leaving the page and coming back finds it exactly as it was,
// because it lives in the database rather than in this component.

type Plans = Record<string, StoredDayPlan | null>;

export function DayPlanPanel({
  employeeId,
  name,
  today,
  tomorrow,
  tomorrowLabel,
  configured,
  plans,
}: {
  employeeId: string;
  name: string;
  /** Day keys in the company's timezone. */
  today: string;
  /** The next day that is actually worked, which on a Thursday is Sunday. */
  tomorrow: string;
  /** That day written out, so nobody has to guess which date it is. */
  tomorrowLabel: string;
  configured: boolean;
  plans: Plans;
}) {
  const [pending, startTransition] = useTransition();
  const [dayKey, setDayKey] = useState(tomorrow);
  const [saved, setSaved] = useState<Plans>(plans);
  const [blocks, setBlocks] = useState<PlannedBlock[]>(plans[tomorrow]?.blocks ?? []);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const plan = saved[dayKey] ?? null;
  const dayName = dayKey === today ? "today" : "tomorrow";
  const onBoard = plan?.appliedAt ? new Date(plan.appliedAt) : null;
  // Everything ticked goes on the day: a step of a project schedules its cell,
  // and anything else becomes a job on the week board.
  const puttable = blocks.filter((block) => block.keep).length;

  function show(key: string, next: Plans = saved) {
    setDayKey(key);
    setBlocks(next[key]?.blocks ?? []);
    setDirty(false);
    setError(null);
    setSaid(null);
  }

  function generate() {
    setError(null);
    setSaid(null);
    startTransition(async () => {
      try {
        const result = await planEmployeeDay(employeeId, dayKey);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const next = { ...saved, [dayKey]: result.plan };
        setSaved(next);
        setBlocks(result.plan.blocks);
        setDirty(false);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That did not work.");
      }
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveDayPlanEdits(
          employeeId,
          dayKey,
          blocks.map((block) => ({ from: block.from, to: block.to, keep: block.keep }))
        );
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSaved({ ...saved, [dayKey]: { ...(plan as StoredDayPlan), blocks, appliedAt: null } });
        setDirty(false);
        setSaid("Saved.");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That did not save.");
      }
    });
  }

  function put() {
    setError(null);
    setSaid(null);
    startTransition(async () => {
      try {
        const result = await applyDayPlan(employeeId, dayKey);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSaved({ ...saved, [dayKey]: { ...(plan as StoredDayPlan), blocks, appliedAt: new Date() } });
        const done: string[] = [];
        if (result.moved > 0) done.push(`${result.moved} ${result.moved === 1 ? "step" : "steps"} scheduled`);
        if (result.jobs > 0) done.push(`${result.jobs} ${result.jobs === 1 ? "job" : "jobs"} on the week board`);
        setSaid(`${done.join(" and ") || "Nothing moved"} for ${dayName}. ${name} has been told.`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That did not work.");
      }
    });
  }

  function edit(index: number, patch: Partial<PlannedBlock>) {
    setBlocks(blocks.map((block, i) => (i === index ? { ...block, ...patch } : block)));
    setDirty(true);
  }

  return (
    <section className="glass rounded-2xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="inline-flex items-center gap-2 text-sm font-medium text-ink">
            <CalendarRange size={15} strokeWidth={2} />
            Plan {name}&apos;s day
          </h2>
          <p className="mt-1 text-xs text-ink/45">
            Built from what you wrote above about how {name} is usually worked, your rules in Settings, and what is
            open on the board. It is kept here until you put it on the day.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1 rounded-full border border-ink/10 p-0.5">
          {[
            { key: tomorrow, label: tomorrowLabel },
            { key: today, label: "Today" },
          ].map((choice) => (
            <button
              key={choice.key}
              type="button"
              onClick={() => show(choice.key)}
              disabled={pending}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                dayKey === choice.key ? "bg-ink text-bg" : "text-ink/50 hover:text-ink"
              )}
            >
              {choice.label}
              {saved[choice.key] ? " ·" : ""}
            </button>
          ))}
        </div>
      </div>

      {!configured && (
        <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
          Planning needs ANTHROPIC_API_KEY set on the server.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={generate} disabled={pending || !configured} className={buttonClasses("outline", "sm")}>
          {plan ? "Generate again" : `Generate ${dayName}'s plan`}
        </button>
        {blocks.length > 0 && (
          <>
            <button type="button" onClick={save} disabled={pending || !dirty} className={buttonClasses("outline", "sm")}>
              Save changes
            </button>
            <button type="button" onClick={put} disabled={pending || dirty || puttable === 0} className={buttonClasses("primary", "sm")}>
              Put {puttable} on {dayName}
            </button>
          </>
        )}
      </div>

      {pending && (
        <p className="mt-3 inline-flex items-center gap-2 text-xs text-ink/45">
          <Sparkles size={13} className="animate-pulse" />
          Working…
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}
      {said && !error && (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {said}
        </p>
      )}

      {blocks.length > 0 && (
        <>
          <p className="mt-4 text-xs text-ink/45">
            {onBoard && !dirty
              ? `On ${dayName}'s board. Edit and put it again to change it.`
              : dirty
                ? "Edited — save it before putting it on the day."
                : `Tick what should go on ${dayName}, and change the times if you want.`}
          </p>

          <ol className="mt-2 flex flex-col">
            {blocks.map((block, index) => (
              <li
                key={`${index}-${block.from}`}
                className={cn(
                  "flex flex-wrap items-start gap-3 border-b border-ink/6 py-2 last:border-0",
                  !block.keep && "opacity-45"
                )}
              >
                <input
                  type="checkbox"
                  checked={block.keep}
                  disabled={pending}
                  onChange={(event) => edit(index, { keep: event.target.checked })}
                  title={
                    block.entryId
                      ? "Schedules the step on the board"
                      : "Goes on the week board as a job for that day"
                  }
                  className="mt-1.5 h-3.5 w-3.5 shrink-0 accent-ink disabled:opacity-30"
                />

                <span className="flex shrink-0 items-center gap-1">
                  <input
                    type="time"
                    value={block.from}
                    disabled={pending}
                    onChange={(event) => edit(index, { from: event.target.value })}
                    className="w-[5.5rem] rounded-lg border border-ink/12 bg-white px-2 py-1 text-xs tabular-nums outline-none focus:border-cyan-strong"
                  />
                  <span className="text-ink/25">–</span>
                  <input
                    type="time"
                    value={block.to}
                    disabled={pending}
                    onChange={(event) => edit(index, { to: event.target.value })}
                    className="w-[5.5rem] rounded-lg border border-ink/12 bg-white px-2 py-1 text-xs tabular-nums outline-none focus:border-cyan-strong"
                  />
                </span>

                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block text-sm text-ink">
                    {block.what}
                  </span>
                  {block.taskName ? (
                    <span className="mt-0.5 block text-[11px] text-ink/40">
                      {block.taskName} · {block.projectName}
                    </span>
                  ) : (
                    <span className="mt-0.5 block text-[11px] text-ink/30">
                      {block.jobId ? "On the week board" : "Goes on the week board"}
                    </span>
                  )}
                  {block.why && (
                    <span dir="auto" className="mt-0.5 block text-xs text-ink/45">
                      {block.why}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>

          {plan && plan.notes.length > 0 && (
            <div className="mt-3 rounded-lg bg-ink/[0.03] px-3 py-2">
              {plan.notes.map((line, index) => (
                <p key={index} dir="auto" className="text-xs leading-relaxed text-ink/55">
                  {line}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
