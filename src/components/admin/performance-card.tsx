import { Gauge } from "lucide-react";
import { describeEstimate, type Indicator } from "@/lib/performance";
import type { Performance } from "@/lib/performance-queries";

// Five numbers about the work, and nothing about the person.
//
// Each one shows what it was measured from. A figure with no sample behind it
// is not shown at all — the reason is shown instead — because a percentage
// standing on two measurements reads like a verdict and is not one.

function describeMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function Figure({
  label,
  indicator,
  render,
  note,
}: {
  label: string;
  indicator: Indicator;
  render: (value: number) => string;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-ink/8 bg-white/70 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink/40">{label}</p>

      {indicator.value === null ? (
        <p className="mt-1 text-xs leading-snug text-ink/45">{indicator.why}</p>
      ) : (
        <>
          <p className="mt-0.5 text-xl font-semibold tabular-nums text-ink">{render(indicator.value)}</p>
          <p className="mt-0.5 text-[11px] text-ink/40">
            from {indicator.sample} {indicator.sample === 1 ? "measurement" : "measurements"}
            {note ? ` · ${note}` : ""}
          </p>
        </>
      )}
    </div>
  );
}

export function PerformanceCard({ performance, name, days }: { performance: Performance; name: string; days: number }) {
  return (
    <section className="glass rounded-2xl p-6">
      <h2 className="inline-flex items-center gap-2 text-sm font-medium text-ink">
        <Gauge size={15} strokeWidth={2} />
        How the work is going
      </h2>
      <p className="mt-1 text-xs text-ink/45">
        {name}&apos;s last {days} days, measured by what came out of the work — what landed by the date it was given,
        what was accepted first time, how often it came back, how long it sat waiting on somebody else, and how close
        the estimates were.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Figure label="Delivered on time" indicator={performance.onTime} render={(value) => `${value}%`} note="work that had a date" />
        <Figure label="Accepted first time" indicator={performance.acceptedFirstTime} render={(value) => `${value}%`} />
        <Figure
          label="Sent back"
          indicator={performance.rework}
          render={(value) => `${value}`}
          note="times per piece of work"
        />
        <Figure label="Waiting on others" indicator={performance.blockedWaiting} render={describeMinutes} />
        <Figure
          label="Estimates"
          indicator={performance.estimates}
          render={(value) => describeEstimate(value)}
        />
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-ink/35">
        Nothing here measures presence, hours at a desk, or how quickly somebody replies. A number is left out rather
        than guessed, and none of this decides anything by itself.
      </p>
    </section>
  );
}
