import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { TargetBar } from "@/components/ui/target-bar";
import { salesLine, salesStanding } from "@/lib/sales";
import { periodLabel } from "@/lib/payroll";
import { formatDayIn } from "@/lib/time";

// One person's month against their target, on their page in the admin. The
// target itself is a field in Details above; a project is counted here by the
// "Sold by" and "Sold on" set on the project.

type SoldProject = { id: string; name: string; clientName: string; soldOn: Date | null };

export function EmployeeSales({
  name,
  projects,
  target,
  period,
  timezone,
}: {
  name: string;
  projects: SoldProject[];
  target: number;
  period: string;
  timezone: string;
}) {
  const standing = salesStanding(projects.length, target);
  const firstName = name.split(" ")[0];

  return (
    <section className="glass rounded-2xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-medium text-ink">
          <TrendingUp size={15} strokeWidth={2} />
          Sales in {periodLabel(period)}
        </h2>
        <TargetBar className="min-w-40" sold={standing.sold} target={standing.target} />
      </div>
      <p className="mt-1 text-xs text-ink/45">
        {salesLine(standing)} A project counts for {firstName} once it names them under Sold by, in the month of its
        Sold on date. The target is in Details above.
      </p>

      {projects.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {projects.map((project) => (
            <li key={project.id} className="rounded-xl border border-ink/8 bg-white/50 px-3 py-2">
              <Link href={`/admin/projects/${project.id}`} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block truncate text-sm font-medium text-ink">
                    {project.name}
                  </span>
                  <span dir="auto" className="block truncate text-xs text-ink/45">
                    {project.clientName}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-ink/45">{formatDayIn(timezone, project.soldOn)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
