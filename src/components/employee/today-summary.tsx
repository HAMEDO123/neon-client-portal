import { percentDone, type StateCounts } from "@/lib/progress";
import { cn } from "@/lib/utils";

// The day at a glance: how much is done, as one number and one bar.
//
// The bar is split by where each task stands — done, with the manager for
// review, being worked on — and what is still pending is the track left over.
// Each part is named in the legend with its count, so nobody has to tell the
// colours apart to read it. The colours are the ones the task cards already
// use for the same states, so the summary and the list below it agree.

const PARTS = [
  { key: "done", label: "Done", fill: "bg-emerald-500" },
  { key: "review", label: "In review", fill: "bg-purple" },
  { key: "working", label: "In progress", fill: "bg-cyan" },
] as const;

export function TodaySummary({ counts }: { counts: StateCounts }) {
  if (counts.total === 0) return null;

  const percent = percentDone(counts);
  const described = `${counts.done} done, ${counts.review} in review, ${counts.working} in progress, ${counts.pending} pending`;

  return (
    <section className="glass rounded-2xl p-4" aria-label="Today's progress">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-ink/50">Today&apos;s progress</p>
          <p className="mt-0.5 text-4xl font-semibold leading-none text-ink">{percent}%</p>
        </div>
        <p className="pb-0.5 text-sm text-ink/55">
          <span className="font-semibold text-ink">{counts.done}</span> of {counts.total} done
        </p>
      </div>

      {/* One bar, a part per state, the pending remainder as the track. A 2px
          gap separates the parts. */}
      <div role="img" aria-label={described} className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-ink/[0.07]">
        {PARTS.filter((part) => counts[part.key] > 0).map((part) => (
          <span
            key={part.key}
            className={cn("h-full", part.fill)}
            style={{ width: `${(counts[part.key] / counts.total) * 100}%` }}
          />
        ))}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink/60">
        {[...PARTS, { key: "pending" as const, label: "Pending", fill: "bg-ink/15" }].map((part) => (
          <li key={part.key} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", part.fill)} aria-hidden />
            {part.label}
            <span className="font-semibold text-ink">{counts[part.key]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
