import { WARNING_LIMIT } from "@/lib/warnings";
import { cn } from "@/lib/utils";

/** How many of the three warnings are used: amber while there is room, red at the limit. */
export function WarningMeter({ count, className }: { count: number; className?: string }) {
  const full = count >= WARNING_LIMIT;

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="flex gap-1" aria-hidden>
        {Array.from({ length: WARNING_LIMIT }, (_, index) => (
          <span
            key={index}
            className={cn(
              "h-1.5 w-5 rounded-full",
              index < count ? (full ? "bg-red-500" : "bg-amber-500") : "bg-ink/10"
            )}
          />
        ))}
      </span>
      <span className="text-xs font-semibold tabular-nums text-ink/60">
        <span className="sr-only">Warnings: </span>
        {Math.min(count, WARNING_LIMIT)}/{WARNING_LIMIT}
      </span>
    </span>
  );
}
