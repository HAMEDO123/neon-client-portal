import Link from "next/link";
import { ChartNoAxesColumn, ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";
import { getDailyProgress, getEmployeeProgress, type DailyProgress } from "@/lib/analytics-queries";
import { asPercent, PERFORMANCE_PENALTY, PERFORMANCE_THRESHOLD } from "@/lib/analytics";
import { dayHeading, sumCounts } from "@/lib/daily-progress";
import { percentDone } from "@/lib/progress";
import { getTimezone } from "@/lib/settings";
import { shiftDayKey, todayKey } from "@/lib/time";
import { periodLabel, periodOf, previousPeriod } from "@/lib/payroll";
import { dayLabel } from "@/lib/week";
import { EmptyState } from "@/components/ui/empty-state";
import { LiveDot } from "@/components/ui/live-dot";
import { StateBar, StateLegend } from "@/components/ui/state-bar";
import { TodaySummary } from "@/components/employee/today-summary";
import { ApplyDeductions } from "@/components/admin/apply-deductions";
import { dotTone } from "@/lib/task-board";
import { cn } from "@/lib/utils";

// How each person's day and month are going.
//
// The day is what was on their list — the same count their phone shows under
// "Today's progress", so a person and their manager never see two numbers for
// one day. The month is finished work over assigned work, and "finished" means
// a task the manager approved from a photo, so it cannot be inflated from a
// phone. Anyone below the monthly target has one JOD taken off and is told why.

/** A real calendar day, or nothing: "2026-02-31" is not a day. */
function validDay(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return shiftDayKey(value, 0) === value ? value : null;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; day?: string }>;
}) {
  const { period: requestedPeriod, day: requestedDay } = await searchParams;
  const timezone = await getTimezone();
  const today = todayKey(timezone);
  const thisMonth = periodOf(today);
  const period = /^\d{4}-\d{2}$/.test(requestedPeriod ?? "") ? requestedPeriod! : thisMonth;
  const day = validDay(requestedDay) ?? today;

  // One after the other, like every multi-query page here: the local Postgres
  // proxy drops the connection when a page fires queries at once.
  const daily = await getDailyProgress(day);
  const rows = await getEmployeeProgress(period);

  // The day and the month move on their own; a link to one keeps the other
  // where it was.
  const href = (next: { day?: string; period?: string }) => {
    const params = new URLSearchParams();
    const nextDay = next.day ?? day;
    const nextPeriod = next.period ?? period;
    if (nextDay !== today) params.set("day", nextDay);
    if (nextPeriod !== thisMonth) params.set("period", nextPeriod);
    const query = params.toString();
    return query ? `/admin/analytics?${query}` : "/admin/analytics";
  };

  const live = day === today;
  const teamDay = sumCounts(daily.filter((person) => person.employee.active).map((person) => person.counts));

  const target = asPercent(PERFORMANCE_THRESHOLD);
  const below = rows.filter((row) => row.shortfall && row.employee.active);
  const owing = below.filter((row) => !row.deduction);
  const team = rows.filter((row) => row.counts.total > 0);
  const average = team.length ? team.reduce((sum, row) => sum + row.progress, 0) / team.length : 1;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Analytics</h1>
      <p className="mt-1 text-sm text-ink/50">How each person&apos;s day and month are going.</p>

      {/* --- The day ---------------------------------------------------------- */}
      <section className="mt-8" aria-labelledby="daily-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 id="daily-heading" className="text-sm font-medium uppercase tracking-wider text-ink/40">
              Daily progress
            </h2>
            <p className="mt-1 text-lg font-semibold text-ink">{dayHeading(day, today)}</p>
          </div>
          <nav className="flex items-center gap-1.5" aria-label="Choose a day">
            <StepLink href={href({ day: shiftDayKey(day, -1) })} label="Previous day" icon={ChevronLeft} />
            {!live && (
              <Link
                href={href({ day: today })}
                scroll={false}
                className="rounded-lg border border-ink/12 bg-white/70 px-3 py-1.5 text-sm font-medium text-ink/70 hover:bg-white"
              >
                Today
              </Link>
            )}
            <StepLink href={href({ day: shiftDayKey(day, 1) })} label="Next day" icon={ChevronRight} />
          </nav>
        </div>
        <p className="mt-1 text-xs text-ink/45">
          Each person&apos;s list for the day — board steps scheduled on it and jobs from the week table — counted
          the way their own phone shows it.
        </p>

        {daily.length === 0 ? (
          <EmptyState
            className="mt-4"
            icon={ChartNoAxesColumn}
            title="No employees yet"
            description="Add the team, and their day appears here."
          />
        ) : (
          <>
            <div className="mt-4">
              {teamDay.total > 0 ? (
                <TodaySummary counts={teamDay} title="Whole team" />
              ) : (
                <p className="rounded-2xl border border-dashed border-ink/12 bg-ink/[0.02] px-4 py-5 text-center text-sm text-ink/45">
                  Nothing was on anyone&apos;s list this day.
                </p>
              )}
            </div>

            <ul className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              {daily.map((person) => (
                <DayCard
                  key={person.employee.id}
                  person={person}
                  live={live}
                  selected={day}
                  hrefFor={(key) => href({ day: key })}
                />
              ))}
            </ul>
          </>
        )}
      </section>

      {/* --- The month -------------------------------------------------------- */}
      <section className="mt-12" aria-labelledby="monthly-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 id="monthly-heading" className="text-sm font-medium uppercase tracking-wider text-ink/40">
              Monthly progress
            </h2>
            <p className="mt-1 text-lg font-semibold text-ink">{periodLabel(period)}</p>
          </div>
          <div className="flex gap-2">
            <PeriodLink href={href({ period: previousPeriod(period) })} label="Previous month" />
            {period !== thisMonth && <PeriodLink href={href({ period: thisMonth })} label="This month" />}
          </div>
        </div>
        <p className="mt-1 text-xs text-ink/45">
          Completed board steps over assigned ones. Below {target}% costs {PERFORMANCE_PENALTY.toFixed(2)} JOD, and the
          employee is told why.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
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
          <>
            {/* On a phone, a card per person: the table needs nine columns. */}
            <ul className="mt-6 flex flex-col gap-3 sm:hidden">
              {rows.map((row) => {
                const percent = asPercent(row.progress);
                return (
                  <li
                    key={row.employee.id}
                    className={cn("glass rounded-2xl p-4", !row.employee.active && "opacity-50")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-medium text-ink">
                          <span className={cn("h-2 w-2 shrink-0 rounded-full", dotTone(row.employee.color))} />
                          <span className="truncate">{row.employee.name}</span>
                        </p>
                        {row.employee.role && <p className="mt-0.5 text-xs text-ink/40">{row.employee.role}</p>}
                      </div>
                      <p
                        className={cn(
                          "text-2xl font-semibold leading-none tabular-nums",
                          row.shortfall ? "text-pink-strong" : "text-ink"
                        )}
                      >
                        {row.counts.total === 0 ? "—" : `${percent}%`}
                      </p>
                    </div>

                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink/8">
                      <div
                        className={cn("h-full rounded-full", row.shortfall ? "bg-pink" : "bg-emerald-500")}
                        style={{ width: `${Math.max(percent, 2)}%` }}
                      />
                    </div>

                    <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
                      <Figure label="Done" value={`${row.counts.completed}/${row.counts.total}`} />
                      <Figure label="Review" value={String(row.counts.awaitingReview)} />
                      <Figure label="Working" value={String(row.counts.inProgress)} />
                      <Figure label="Pending" value={String(row.counts.pending)} />
                      <Figure label="Late" value={String(row.counts.overdue)} alert={row.counts.overdue > 0} />
                      <Figure
                        label="On time"
                        value={row.counts.completed === 0 ? "—" : `${asPercent(row.timeliness)}%`}
                      />
                      <Figure
                        label="Deduction"
                        value={row.deduction ? `−${row.deduction.amount.toFixed(2)}` : "—"}
                        alert={Boolean(row.deduction)}
                        className="col-span-2"
                      />
                    </dl>
                  </li>
                );
              })}
            </ul>

            <div className="mt-8 hidden overflow-x-auto rounded-2xl border border-ink/8 sm:block">
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
          </>
        )}
      </section>
    </div>
  );
}

/** One person's day: how much of it is done, what it is made of, and what they are on right now. */
function DayCard({
  person,
  live,
  selected,
  hrefFor,
}: {
  person: DailyProgress;
  live: boolean;
  selected: string;
  hrefFor: (dayKey: string) => string;
}) {
  const { employee, counts, history, working } = person;

  return (
    <li className={cn("glass flex flex-col rounded-2xl p-4", !employee.active && "opacity-50")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-ink">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", dotTone(employee.color))} aria-hidden />
            <span className="truncate">{employee.name}</span>
          </p>
          {employee.role && <p className="mt-0.5 truncate text-xs text-ink/40">{employee.role}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-2xl font-semibold leading-none tabular-nums text-ink">
            {counts.total === 0 ? "—" : `${percentDone(counts)}%`}
          </p>
          <p className="mt-1 text-xs text-ink/45">
            {counts.total === 0 ? "Nothing planned" : `${counts.done} of ${counts.total} done`}
          </p>
        </div>
      </div>

      {counts.total > 0 && (
        <>
          <StateBar counts={counts} className="mt-3" />
          <StateLegend counts={counts} className="mt-2" />
        </>
      )}

      {/* Present tense, so only on today. */}
      {live && working.length > 0 && (
        <div className="mt-3 rounded-xl border border-cyan/20 bg-cyan/[0.06] px-3 py-2">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-cyan-strong">
            <LiveDot />
            Working on now
          </p>
          <ul className="mt-1 flex flex-col gap-0.5 text-sm text-ink/80">
            {working.map((item) => (
              <li key={item.id} className="truncate">
                <span dir="auto">{item.title}</span>
                {item.project && <span className="text-ink/45"> · {item.project}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <DayStrip history={history} selected={selected} live={live} hrefFor={hrefFor} />
    </li>
  );
}

/**
 * The seven days up to the chosen one, a bar per day: how much of that day's
 * list is done. A day with nothing on it gets an outline rather than an empty
 * bar, so "nothing planned" and "nothing done" do not look alike. Each opens
 * its day.
 */
function DayStrip({
  history,
  selected,
  live,
  hrefFor,
}: {
  history: DailyProgress["history"];
  selected: string;
  live: boolean;
  hrefFor: (dayKey: string) => string;
}) {
  const chosen = dayLabel(selected);

  return (
    <div className="mt-4 border-t border-ink/6 pt-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink/40">
        {live ? "Last 7 days" : `7 days to ${chosen.weekday} ${chosen.day} ${chosen.month}`}
      </p>
      <div className="mt-2 grid grid-cols-7 gap-1">
        {history.map((point) => {
          const label = dayLabel(point.dayKey);
          const share = point.total === 0 ? 0 : point.done / point.total;
          const described =
            point.total === 0
              ? `${label.weekday} ${label.day} ${label.month}: nothing planned`
              : `${label.weekday} ${label.day} ${label.month}: ${point.done} of ${point.total} done (${Math.round(share * 100)}%)`;
          const isSelected = point.dayKey === selected;

          return (
            <Link
              key={point.dayKey}
              href={hrefFor(point.dayKey)}
              scroll={false}
              aria-label={described}
              title={described}
              aria-current={isSelected ? "date" : undefined}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg px-0.5 py-1 transition-colors hover:bg-ink/[0.04]",
                isSelected && "bg-ink/[0.04]"
              )}
            >
              <span
                className={cn(
                  "flex h-10 w-full max-w-6 items-end overflow-hidden rounded",
                  point.total === 0 ? "border border-dashed border-ink/15" : "bg-ink/[0.06]"
                )}
              >
                {share > 0 && (
                  <span className="w-full rounded bg-emerald-500" style={{ height: `${Math.max(share * 100, 8)}%` }} />
                )}
              </span>
              <span className={cn("text-[10px] leading-none", isSelected ? "font-semibold text-ink" : "text-ink/40")}>
                {label.weekday}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function StepLink({ href, label, icon: Icon }: { href: string; label: string; icon: typeof ChevronLeft }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-label={label}
      className="rounded-lg border border-ink/12 bg-white/70 p-2 text-ink/60 hover:bg-white"
    >
      <Icon size={16} strokeWidth={2} />
    </Link>
  );
}

function PeriodLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      scroll={false}
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

function Figure({
  label,
  value,
  alert = false,
  className,
}: {
  label: string;
  value: string;
  alert?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg bg-ink/[0.03] px-1 py-1.5", className)}>
      <dt className="text-[10px] font-medium uppercase tracking-wider text-ink/40">{label}</dt>
      <dd className={cn("mt-0.5 text-sm font-semibold tabular-nums", alert ? "text-pink-strong" : "text-ink/70")}>
        {value}
      </dd>
    </div>
  );
}
