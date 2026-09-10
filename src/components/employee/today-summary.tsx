import { percentDone, type StateCounts } from "@/lib/progress";
import { StateBar, StateLegend } from "@/components/ui/state-bar";

// The day at a glance: how much is done, as one number and one bar.
//
// The bar is split by where each task stands, and each part is named in the
// legend with its count (see state-bar.tsx). The same card heads the manager's
// daily analytics for the whole team, which is why the title can change.

export function TodaySummary({ counts, title = "Today's progress" }: { counts: StateCounts; title?: string }) {
  if (counts.total === 0) return null;

  const percent = percentDone(counts);

  return (
    <section className="glass rounded-2xl p-4" aria-label={title}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-ink/50">{title}</p>
          <p className="mt-0.5 text-4xl font-semibold leading-none text-ink">{percent}%</p>
        </div>
        <p className="pb-0.5 text-sm text-ink/55">
          <span className="font-semibold text-ink">{counts.done}</span> of {counts.total} done
        </p>
      </div>

      <StateBar counts={counts} className="mt-3" />
      <StateLegend counts={counts} className="mt-3" />
    </section>
  );
}
