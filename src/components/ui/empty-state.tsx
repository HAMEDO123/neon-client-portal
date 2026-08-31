import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink/12 bg-ink/[0.02] px-8 py-16 text-center",
        className
      )}
    >
      {Icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-ink/5 text-ink/40">
          <Icon size={22} strokeWidth={1.5} />
        </div>
      )}
      <p className="text-sm font-medium text-ink/70">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-sm text-ink/45">{description}</p>}
    </div>
  );
}
