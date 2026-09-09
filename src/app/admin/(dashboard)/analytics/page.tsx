import Link from "next/link";
import { ChartNoAxesColumn, TriangleAlert } from "lucide-react";
import { getEmployeeProgress } from "@/lib/analytics-queries";
import { asPercent, PERFORMANCE_PENALTY, PERFORMANCE_THRESHOLD } from "@/lib/analytics";
import { getTimezone } from "@/lib/settings";
import { todayKey } from "@/lib/time";
import { periodLabel, periodOf, previousPeriod } from "@/lib/payroll";
import { EmptyState } from "@/components/ui/empty-state";
import { ApplyDeductions } from "@/components/admin/apply-deductions";
import { dotTone } from "@/lib/task-board";
import { cn } from "@/lib/utils";

// How each person's month is going.
//
// Progress is finished work over assigned work — and "finished" means a task
// the manager approved from a photo, so this table cannot be inflated from a
// phone. Anyone below the target has one JOD taken off and is told why.

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period: requested } = await searchParams;
  const timezone = await getTimezone();
  const thisMonth = periodOf(todayKey(timezone));
  const period = /^\d{4}-\d{2}$/.test(requested ?? "") ? requested! : thisMonth;

  const rows = await getEmployeeProgress(period);

  const target = asPercent(PERFORMANCE_THRESHOLD);
  const below = rows.filter((row) => row.shortfall && row.employee.active);
  const owing = below.filter((row) => !row.deduction);
  const team = rows.filter((row) => row.counts.total > 0);
  const average = team.length ? team.reduce((sum, row) => sum + row.progress, 0) / team.length : 1;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Analytics</h1>
          <p className="mt-1 text-sm text-ink/50">
            {periodLabel(period)} · completed tasks over assigned tasks. Below {target}% costs{" "}
            {PERFORMANCE_PENALTY.toFixed(2)} JOD, and the employee is told why.
          </p>
        </div>

        <div className="flex gap-2">
          <PeriodLink period={previousPeriod(period)} label="Previous month" />
          {period !== thisMonth && <PeriodLink period={thisMonth} label="This month" />}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Team" value={String(rows.length)} />
        <Stat label="Average progress" value={`${asPercent(average)}%`} />
        <Stat label={`Below ${target}%`} value={String(below.length)} />
        <Stat
          label="Deductions applied"
          value={`${rows.filter((row) => row.deduction).length} of ${below.length}`}
        />
      </div>

      {owing.length > 0 && (
        <div className="mt-6 rounded-2xl border border-pink/20 bg-pink/[0.06] p-4">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-pink-strong">
            <TriangleAlert size={16} strokeWidth={2} />
            {owing.length === 1
              ? `${owing[0].employee.name} is below ${target}% for ${periodLabel(period)}.`
              : `${owing.length} people are below ${target}% for ${periodLabel(period)}.`}
          </p>
          <p className="mt-1 text-sm text-ink/60">
            Applying this takes {PERFORMANCE_PENALTY.toFixed(2)} JOD off each of their salaries for the period and
            sends them a notification with the numbers behind it. Running it twice changes nothing.
          </p>
          <div className="mt-3">
            <ApplyDeductions period={period} count={owing.length} />
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={ChartNoAxesColumn}
          title="No employees yet"
          description="Add the team, and their progress appears here."
        />
      ) : (
        <div className="mt-8 overflow-x-auto rounded-2xl border border-ink/8">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink/[0.03] text-xs uppercase tracking-wider text-ink/40">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Progress</th>
                <th className="px-4 py-3 text-right">Done</th>
                <th className="px-4 py-3 text-right">In review</th>
                <th className="px-4 py-3 text-right">Working</th>
                <th className="px-4 py-3 text-right">Pending</th>
                <th className="px-4 py-3 text-right">Late</th>
                <th className="px-4 py-3 text-right">On time</th>
                <th className="px-4 py-3 text-right">Deduction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/6">
              {rows.map((row) => {
                const percent = asPercent(row.progress);
                return (
                  <tr key={row.employee.id} className={cn(!row.employee.active && "opacity-50")}>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2">
                        <span className={cn("h-2 w-2 rounded-full", dotTone(row.employee.color))} />
                        <span className="font-medium text-ink">{row.employee.name}</span>
                      </span>
                      {row.employee.role && <p className="mt-0.5 text-xs text-ink/40">{row.employee.role}</p>}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-ink/8">
                          <div
                            className={cn("h-full rounded-full", row.shortfall ? "bg-pink" : "bg-emerald-500")}
                            style={{ width: `${Math.max(percent, 2)}%` }}
                          />
                        </div>
                        <span
                          className={cn(
                            "text-sm font-semibold tabular-nums",
                            row.shortfall ? "text-pink-strong" : "text-ink"
                          )}
                        >
                          {row.counts.total === 0 ? "—" : `${percent}%`}
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-right tabular-nums text-ink/70">
                      {row.counts.completed}/{row.counts.total}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink/50">{row.counts.awaitingReview}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink/50">{row.counts.inProgress}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink/50">{row.counts.pending}</td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right tabular-nums",
                        row.counts.overdue > 0 ? "font-semibold text-pink-strong" : "text-ink/40"
                      )}
                    >
                      {row.counts.overdue}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink/50">
                      {row.counts.completed === 0 ? "—" : `${asPercent(row.timeliness)}%`}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.deduction ? (
                        <span className="font-semibold text-pink-strong">−{row.deduction.amount.toFixed(2)}</span>
                      ) : (
                        <span className="text-ink/30">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PeriodLink({ period, label }: { period: string; label: string }) {
  return (
    <Link
      href={`/admin/analytics?period=${period}`}
      className="rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm font-medium text-ink/70 hover:bg-white"
    >
      {label}
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink/40">{label}</p>
      <p className="mt-1 text-xl font-semibold text-ink">{value}</p>
    </div>
  );
}
