"use client";

import { useState, useTransition } from "react";
import { CalendarRange, Sparkles } from "lucide-react";
import { planEmployeeDay } from "@/lib/actions/day-plan-actions";
import type { DayPlanResult } from "@/lib/ai/day-plan";
import { buttonClasses } from "@/components/ui/buttons";

// A proposed day for one person, read off their habits, the studio's rules and
// the board as it stands. It is a suggestion on a screen: nothing here saves,
// schedules or notifies anybody.

export function DayPlanPanel({
  employeeId,
  name,
  today,
  tomorrow,
  configured,
}: {
  employeeId: string;
  name: string;
  /** Day keys in the company's timezone. */
  today: string;
  tomorrow: string;
  configured: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<DayPlanResult | null>(null);
  const [asked, setAsked] = useState<string | null>(null);

  function plan(dayKey: string, label: string) {
    setAsked(label);
    startTransition(async () => {
      try {
        setResult(await planEmployeeDay(employeeId, dayKey));
      } catch (error) {
        setResult({ ok: false, error: error instanceof Error ? error.message : "That did not work." });
      }
    });
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
            actually open on the board — blocked and waiting work included. Nothing is saved or sent.
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => plan(today, "today")}
            disabled={pending || !configured}
            className={buttonClasses("outline", "sm")}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => plan(tomorrow, "tomorrow")}
            disabled={pending || !configured}
            className={buttonClasses("primary", "sm")}
          >
            {pending ? "Planning…" : "Tomorrow"}
          </button>
        </div>
      </div>

      {!configured && (
        <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
          Planning needs ANTHROPIC_API_KEY set on the server.
        </p>
      )}

      {pending && (
        <p className="mt-4 inline-flex items-center gap-2 text-xs text-ink/45">
          <Sparkles size={13} className="animate-pulse" />
          Reading the board and writing {name}&apos;s {asked}…
        </p>
      )}

      {!pending && result && !result.ok && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {result.error}
        </p>
      )}

      {!pending && result?.ok && (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-ink/40">{result.dayLabel}</p>

          {result.blocks.length === 0 && result.rest.length === 0 && (
            <p className="mt-2 text-sm text-ink/50">Nothing to plan — there is no open work for {name}.</p>
          )}

          <ol className="mt-2 flex flex-col">
            {result.blocks.map((block, index) => (
              <li key={`${block.from}-${index}`} className="flex gap-3 border-b border-ink/6 py-2 last:border-0">
                <span className="w-24 shrink-0 pt-0.5 text-xs font-medium tabular-nums text-ink/60">
                  {block.from}–{block.to}
                </span>
                <span className="min-w-0">
                  {/* Written in whichever language the manager's own notes are
                      in, so each line carries its own direction. */}
                  <span dir="auto" className="block text-sm text-ink">
                    {block.what}
                  </span>
                  {block.why && (
                    <span dir="auto" className="mt-0.5 block text-xs text-ink/45">
                      {block.why}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>

          {result.rest.length > 0 && (
            <div className="mt-3 rounded-lg bg-ink/[0.03] px-3 py-2">
              {result.rest.map((line, index) => (
                <p key={index} dir="auto" className="text-xs leading-relaxed text-ink/55">
                  {line}
                </p>
              ))}
            </div>
          )}

          <p className="mt-3 text-[11px] text-ink/35">
            A suggestion only. To make it real, set the days and times on the board.
          </p>
        </div>
      )}
    </section>
  );
}
