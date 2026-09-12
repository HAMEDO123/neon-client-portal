import { salesStanding } from "@/lib/sales";
import { cn } from "@/lib/utils";

/** How far through a monthly target someone is: green once it is met. */
export function TargetBar({ sold, target, className }: { sold: number; target: number; className?: string }) {
  const standing = salesStanding(sold, target);

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="h-2 min-w-20 flex-1 overflow-hidden rounded-full bg-ink/10">
        <div
          className={cn("h-full rounded-full", standing.met ? "bg-emerald-500" : "bg-cyan-strong")}
          style={{ width: `${standing.percent}%` }}
        />
      </div>
      <span className="shrink-0 text-xs font-semibold tabular-nums text-ink/60">
        <span className="sr-only">Sold: </span>
        {standing.sold}/{standing.target}
      </span>
    </div>
  );
}
