import { cn } from "@/lib/utils";

export function SectionHeader({
  eyebrow,
  title,
  description,
  align = "left",
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center", className)}>
      {eyebrow && (
        <span className="text-xs font-medium uppercase tracking-[0.2em] text-cyan-strong">{eyebrow}</span>
      )}
      <h2 className="mt-3 text-3xl font-semibold text-ink sm:text-4xl">{title}</h2>
      {description && <p className="mt-3 text-base leading-relaxed text-ink/60">{description}</p>}
    </div>
  );
}
