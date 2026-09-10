import { cn } from "@/lib/utils";

// Something is happening right now: a small dot with a ring spreading from it,
// like a "live" light. The ring is only motion, so it stops for anyone who has
// asked for less motion — the dot still says it.
export function LiveDot({ className, size = "md" }: { className?: string; size?: "sm" | "md" }) {
  return (
    <span className={cn("inline-flex shrink-0", size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2", className)} aria-hidden>
      <span className="relative inline-flex h-full w-full">
        <span className="absolute inset-0 rounded-full bg-cyan-strong/60 motion-safe:animate-ping" />
        <span className="relative inline-flex h-full w-full rounded-full bg-cyan-strong" />
      </span>
    </span>
  );
}
