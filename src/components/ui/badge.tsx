import { cn } from "@/lib/utils";

type Tone = "cyan" | "purple" | "pink" | "orange" | "neutral" | "success" | "warning";

const TONES: Record<Tone, string> = {
  cyan: "bg-cyan/10 text-cyan-strong border-cyan/20",
  purple: "bg-purple/10 text-purple-strong border-purple/20",
  pink: "bg-pink/10 text-pink-strong border-pink/20",
  orange: "bg-orange/10 text-orange-strong border-orange/20",
  neutral: "bg-ink/5 text-ink/70 border-ink/10",
  success: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  warning: "bg-amber-500/10 text-amber-700 border-amber-500/20",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-wider",
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
