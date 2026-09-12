import { TrendingUp } from "lucide-react";
import { TargetBar } from "@/components/ui/target-bar";
import { salesLine, salesStanding } from "@/lib/sales";
import { periodLabel } from "@/lib/payroll";
import { formatDayIn } from "@/lib/time";
import { cn } from "@/lib/utils";

// The month's sales target on the employee's home screen: how many projects
// they have sold this month, against what they were asked for, and which ones.

type SoldProject = { id: string; name: string; clientName: string; soldOn: Date | null };

export function SalesCard({
  projects,
  target,
  period,
  timezone,
}: {
  projects: SoldProject[];
  target: number;
  period: string;
  timezone: string;
}) {
  const standing = salesStanding(projects.length, target);

  return (
    <section aria-label="Sales target" className="rounded-2xl border border-ink/8 bg-white/60 p-4">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
        <TrendingUp size={16} strokeWidth={2} />
        Projects sold in {periodLabel(period)}
      </h2>

      <TargetBar className="mt-3" sold={standing.sold} target={standing.target} />
      <p className={cn("mt-2 text-xs", standing.met ? "font-medium text-emerald-700" : "text-ink/50")}>
        {salesLine(standing)}
      </p>

      {projects.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5 border-t border-ink/8 pt-3">
          {projects.map((project) => (
            <li key={project.id} className="flex items-baseline justify-between gap-3 text-sm">
              <span dir="auto" className="min-w-0 flex-1 truncate text-ink">
                {project.name}
              </span>
              <span className="shrink-0 text-xs text-ink/45">{formatDayIn(timezone, project.soldOn)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
