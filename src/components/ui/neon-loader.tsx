import { cn } from "@/lib/utils";

// The NEON mark, loading (asked for on 2026-11-18: "small logo loading
// animations"): the four letters light up one after the other over a clay
// line that draws itself and wipes away. Pure CSS (globals.css, `.neon-loader`),
// so it runs before any script has loaded — which is exactly when it is shown —
// and stands still for somebody who has asked their device for less motion.

export function NeonLoader({ size = "page", className }: { size?: "page" | "small"; className?: string }) {
  const small = size === "small";
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn("neon-loader flex flex-col items-center justify-center", small ? "gap-1" : "min-h-[50vh] gap-2", className)}
    >
      <div aria-hidden className={cn("font-display font-semibold tracking-[0.06em] text-ink", small ? "text-lg" : "text-4xl")}>
        {"NEON".split("").map((letter, index) => (
          <span key={index} className="neon-loader-letter" style={{ animationDelay: `${index * 0.12}s` }}>
            {letter}
          </span>
        ))}
      </div>
      <div aria-hidden className={cn("neon-loader-line rounded-full bg-clay", small ? "h-0.5 w-12" : "h-0.5 w-28")} />
    </div>
  );
}
