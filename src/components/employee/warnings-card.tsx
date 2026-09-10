import { TriangleAlert } from "lucide-react";
import { WarningMeter } from "@/components/ui/warning-meter";
import { warningStanding } from "@/lib/warnings";
import { formatDayIn } from "@/lib/time";

// The employee's warnings, pinned to the top of their home screen for as long
// as the manager keeps them on record. It can't be dismissed: it is meant to
// be there every time the app opens.

type Warning = { id: string; reason: string; createdAt: Date };

export function WarningsCard({ warnings, timezone }: { warnings: Warning[]; timezone: string }) {
  if (warnings.length === 0) return null;
  const standing = warningStanding(warnings.length);

  return (
    <section aria-label="Warnings" className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-amber-900">
          <TriangleAlert size={16} strokeWidth={2.25} />
          {standing.count === 1 ? "You have a warning" : `You have ${standing.count} warnings`}
        </h2>
        <WarningMeter count={standing.count} />
      </div>

      <ol className="mt-3 flex flex-col gap-2">
        {warnings.map((warning, index) => (
          <li key={warning.id} className="rounded-xl bg-white/80 px-3 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-amber-800/70">
              Warning {index + 1} · {formatDayIn(timezone, warning.createdAt)}
            </p>
            <p dir="auto" className="mt-0.5 whitespace-pre-line text-sm text-ink">
              {warning.reason}
            </p>
          </li>
        ))}
      </ol>

      {standing.nextIsFinal && (
        <p className="mt-3 text-xs font-semibold text-red-700">One more warning closes your account.</p>
      )}
    </section>
  );
}
