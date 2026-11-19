import { percentDone, type StateCounts } from "@/lib/progress";
import { StateBar, StateLegend } from "@/components/ui/state-bar";

// The day at a glance: how much is done, as one number and one bar.
//
// The bar is split by where each task stands, and each part is named in the
// legend with its count (see state-bar.tsx). The same card heads the manager's
// daily analytics for the whole team, which is why the title can change.

export function TodaySummary({
  counts,
  title = "Today's progress",
  look = "bar",
}: {
  counts: StateCounts;
  title?: string;
  /** "ring" is the home screen's tile (design 2): the share done as a ring. */
  look?: "bar" | "ring";
}) {
  if (counts.total === 0) return null;

  const percent = percentDone(counts);

  if (look === "ring") {
    return (
      <section className="glass flex h-full flex-col rounded-2xl p-5" aria-label={title}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/55">{title}</p>
        <div className="flex flex-1 items-center justify-center py-3">
          <div
            role="img"
            aria-label={`${percent}% done`}
            className="grid h-32 w-32 place-items-center rounded-full"
            style={{
              background: `conic-gradient(var(--clay) 0 ${percent}%, color-mix(in srgb, var(--ink) 9%, transparent) ${percent}% 100%)`,
            }}
          >
            <div className="grid h-[6.5rem] w-[6.5rem] place-items-center rounded-full bg-card text-center">
              <div>
                <p className="text-3xl font-semibold leading-none text-ink">{percent}%</p>
                <p className="mt-1 text-xs text-ink/55">
                  {counts.done} of {counts.total}
                </p>
              </div>
            </div>
          </div>
        </div>
        <StateLegend counts={counts} />
      </section>
    );
  }

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
