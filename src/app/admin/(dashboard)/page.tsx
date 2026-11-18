import Link from "next/link";
import { FolderKanban, CheckCircle2, Clock, TrendingUp } from "lucide-react";
import { getDashboardStats, getProjects } from "@/lib/queries";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/format";
import { PIPELINE_STATUSES } from "@/lib/constants";
import { dayBoard } from "@/lib/day-board-queries";
import { DayBoardList } from "@/components/admin/day-board-list";
import { getTimezone } from "@/lib/settings";
import { dayKeyToDate, formatDayIn, todayKey } from "@/lib/time";

const PIPELINE_LABEL = new Map(PIPELINE_STATUSES.map((s) => [s.value, s.label]));

function publishTone(state: string) {
  if (state === "PUBLISHED") return "success" as const;
  if (state === "ARCHIVED") return "neutral" as const;
  return "warning" as const;
}

export default async function AdminDashboardPage() {
  // One after another, which is the convention everywhere else here. This page
  // fired both at once, and that is the pattern the local database falls over
  // on (README, "Run queries one after another"). Production copes either way,
  // so nothing is lost by reading them in order.
  const stats = await getDashboardStats();
  const projects = await getProjects();

  // The team's day, read one person at a time rather than joined onto the call
  // above: the gatherer runs a handful of queries per person, and firing those
  // alongside everything else is what the local database falls over on.
  const timezone = await getTimezone();
  const today = todayKey(timezone);
  const days = await dayBoard(today);
  const dayLabel = formatDayIn(timezone, dayKeyToDate(today)) ?? "today";

  const cards = [
    { label: "Total Projects", value: stats.total, icon: FolderKanban, tone: "cyan" as const },
    { label: "Published", value: stats.published, icon: CheckCircle2, tone: "purple" as const },
    { label: "Pending Approvals", value: stats.pendingApprovals, icon: Clock, tone: "orange" as const },
    { label: "Updated This Week", value: stats.recentlyUpdated, icon: TrendingUp, tone: "pink" as const },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-ink">Dashboard</h1>
          <p className="mt-1 text-sm text-ink/50">An overview of every client project delivery.</p>
        </div>
        <Link
          href="/admin/projects/new"
          className="shrink-0 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90"
        >
          + New Project
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:mt-8 sm:grid-cols-4 sm:gap-4">
        {cards.map((c) => (
          // Label first with its icon, the number as the answer under it: half
          // the height of the old stacked tile, and it reads in one go.
          <div key={c.label} className="glass rounded-2xl p-3.5 sm:p-5">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-ink/45 sm:text-xs">
              <c.icon size={14} strokeWidth={1.75} className="shrink-0 text-ink/35" />
              <span className="truncate">{c.label}</span>
            </p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums text-ink sm:mt-2">{c.value}</p>
          </div>
        ))}
      </div>

      {/* The team's day before the catalogue of projects: what needs somebody
          today is more urgent than what exists. */}
      <h2 className="mt-10 text-sm font-medium uppercase tracking-wider text-ink/40">The day · {dayLabel}</h2>
      <div className="mt-4">
        <DayBoardList days={days} dayLabel={dayLabel} />
      </div>

      <h2 className="mt-10 text-sm font-medium uppercase tracking-wider text-ink/40">All Projects</h2>

      {projects.length === 0 ? (
        <EmptyState
          className="mt-4"
          title="No projects yet"
          description="Create your first client project to start building its delivery portal."
        />
      ) : (
        // Cover cards (the new UI, "everything by project", 2026-11-18): the
        // studio knows its projects by their renders long before their names.
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/admin/projects/${p.id}`}
              className="glass group flex flex-col overflow-hidden rounded-2xl transition-shadow hover:shadow-lg"
            >
              <div
                className="aspect-[16/10] w-full bg-clay-soft bg-cover bg-center"
                style={p.coverImageUrl ? { backgroundImage: `url(${p.coverImageUrl})` } : undefined}
              />
              <div className="flex flex-1 flex-col gap-1.5 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p dir="auto" className="min-w-0 truncate text-base font-semibold text-ink">
                    {p.name}
                  </p>
                  <Badge tone={publishTone(p.publishState)}>{p.publishState}</Badge>
                </div>
                <p dir="auto" className="truncate text-sm text-ink/55">
                  {p.clientName} {p.location ? `· ${p.location}` : ""}
                </p>
                <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-xs text-ink/45">
                  <Badge tone="neutral">{PIPELINE_LABEL.get(p.pipelineStatus) ?? p.pipelineStatus}</Badge>
                  <span>
                    {p._count.approvals} approvals · {p._count.comments} comments
                  </span>
                </div>
                <p className="text-[11px] text-ink/40">Updated {formatDate(p.updatedAt)}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
