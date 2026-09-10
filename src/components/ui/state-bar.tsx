import type { StateCounts } from "@/lib/progress";
import { cn } from "@/lib/utils";

// Where a list of tasks stands, as one bar.
//
// A part per state — done, with the manager for review, being worked on — and
// what is still pending is the track left over. The legend names each part
// with its count, so nobody has to tell the colours apart to read it. The
// colours are the ones the task cards and the board use for the same states.

const PARTS = [
  { key: "done", label: "Done", fill: "bg-emerald-500" },
  { key: "review", label: "In review", fill: "bg-purple" },
  { key: "working", label: "In progress", fill: "bg-cyan" },
] as const;

const PENDING = { key: "pending", label: "Pending", fill: "bg-ink/15" } as const;

function describe(counts: StateCounts) {
  return `${counts.done} done, ${counts.review} in review, ${counts.working} in progress, ${counts.pending} pending`;
}

/** The bar: a part per state, the pending remainder as the track, 2px between parts. */
export function StateBar({ counts, className }: { counts: StateCounts; className?: string }) {
  return (
    <div
      role="img"
      aria-label={describe(counts)}
      className={cn("flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-ink/[0.07]", className)}
    >
      {counts.total > 0 &&
        PARTS.filter((part) => counts[part.key] > 0).map((part) => (
          <span
            key={part.key}
            className={cn("h-full", part.fill)}
            style={{ width: `${(counts[part.key] / counts.total) * 100}%` }}
          />
        ))}
    </div>
  );
}

/** Each part named, with its count. */
export function StateLegend({ counts, className }: { counts: StateCounts; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink/60", className)}>
      {[...PARTS, PENDING].map((part) => (
        <li key={part.key} className="inline-flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", part.fill)} aria-hidden />
          {part.label}
          <span className="font-semibold text-ink">{counts[part.key]}</span>
        </li>
      ))}
    </ul>
  );
}
