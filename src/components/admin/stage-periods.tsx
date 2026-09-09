import { CalendarRange, Timer } from "lucide-react";
import { setStageDuration } from "@/lib/actions/task-actions";
import { cumulativeDays, totalDays } from "@/lib/stage-schedule";
import { dotTone } from "@/lib/task-board";
import { cn } from "@/lib/utils";

// How long each step of the process is allowed to take.
//
// The days are set once, here, and every project inherits them — the same way
// every project inherits the steps themselves. Reading down the list gives the
// running total, so "the plan through the site visit is five days" is something
// you can see rather than something you have to add up.

type Stage = {
  id: string;
  name: string;
  durationDays: number | null;
  employee: { name: string; color: string } | null;
};

export function StagePeriods({ stages }: { stages: Stage[] }) {
  const spans = cumulativeDays(stages.map((stage) => stage.durationDays));
  const total = totalDays(stages.map((stage) => stage.durationDays));
  const untimed = stages.filter((stage) => stage.durationDays == null).length;

  return (
    <section>
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
        <Timer size={15} strokeWidth={2} />
        Stage periods
      </h2>
      <p className="mt-1 text-sm text-ink/50">
        How many days each step gets once it starts. A step begins when the one before it is approved, so these
        add up into a schedule — and the employee sees a countdown on the task rather than a date to remember.
        Leave one blank to let it run untimed.
      </p>

      {stages.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-ink/15 px-4 py-6 text-center text-sm text-ink/40">
          No process steps yet — add them on the Tasks board and they appear here.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-ink/8 bg-white/50 px-4 py-3">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
              <CalendarRange size={15} strokeWidth={1.75} />
              {total === 0 ? "Nothing timed yet" : `${total} days end to end`}
            </span>
            {untimed > 0 && total > 0 && (
              <span className="text-xs text-ink/45">
                {untimed} {untimed === 1 ? "step is" : "steps are"} untimed and not counted in that.
              </span>
            )}
          </div>

          <ul className="mt-3 flex flex-col gap-2">
            {stages.map((stage, index) => {
              const span = spans[index];
              return (
                <li key={stage.id}>
                  <form
                    action={setStageDuration.bind(null, stage.id)}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-ink/8 bg-white/50 px-4 py-3"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          stage.employee ? dotTone(stage.employee.color) : "bg-ink/20"
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">{stage.name}</span>
                        <span className="block truncate text-xs text-ink/40">
                          {stage.employee?.name ?? "Unassigned"}
                          {span.endDay
                            ? ` · day ${span.startDay}${span.endDay > span.startDay ? `–${span.endDay}` : ""}`
                            : ""}
                        </span>
                      </span>
                    </span>

                    <label className="flex items-center gap-2">
                      <input
                        name="durationDays"
                        type="number"
                        min="1"
                        max="365"
                        step="1"
                        defaultValue={stage.durationDays ?? ""}
                        placeholder="—"
                        aria-label={`Days for ${stage.name}`}
                        className="w-20 rounded-lg border border-ink/12 bg-white px-2 py-1.5 text-sm outline-none focus:border-cyan-strong"
                      />
                      <span className="text-xs text-ink/45">days</span>
                    </label>

                    <button
                      type="submit"
                      className="rounded-lg border border-ink/12 bg-white/70 px-3 py-1.5 text-sm font-medium text-ink/70 hover:bg-white"
                    >
                      Save
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
