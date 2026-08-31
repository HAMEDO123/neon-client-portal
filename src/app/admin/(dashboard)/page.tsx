import Link from "next/link";
import { FolderKanban, CheckCircle2, Clock, TrendingUp, ArrowRight } from "lucide-react";
import { getDashboardStats, getProjects } from "@/lib/queries";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/format";
import { PIPELINE_STATUSES } from "@/lib/constants";

const PIPELINE_LABEL = new Map(PIPELINE_STATUSES.map((s) => [s.value, s.label]));

function publishTone(state: string) {
  if (state === "PUBLISHED") return "success" as const;
  if (state === "ARCHIVED") return "neutral" as const;
  return "warning" as const;
}

export default async function AdminDashboardPage() {
  const [stats, projects] = await Promise.all([getDashboardStats(), getProjects()]);

  const cards = [
    { label: "Total Projects", value: stats.total, icon: FolderKanban, tone: "cyan" as const },
    { label: "Published", value: stats.published, icon: CheckCircle2, tone: "purple" as const },
    { label: "Pending Approvals", value: stats.pendingApprovals, icon: Clock, tone: "orange" as const },
    { label: "Updated This Week", value: stats.recentlyUpdated, icon: TrendingUp, tone: "pink" as const },
  ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Dashboard</h1>
          <p className="mt-1 text-sm text-ink/50">An overview of every client project delivery.</p>
        </div>
        <Link href="/admin/projects/new" className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90">
          + New Project
        </Link>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="glass rounded-2xl p-5">
            <c.icon size={18} strokeWidth={1.75} className="text-ink/40" />
            <p className="mt-3 text-2xl font-semibold text-ink">{c.value}</p>
            <p className="mt-1 text-xs text-ink/50">{c.label}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-sm font-medium uppercase tracking-wider text-ink/40">All Projects</h2>

      {projects.length === 0 ? (
        <EmptyState
          className="mt-4"
          title="No projects yet"
          description="Create your first client project to start building its delivery portal."
        />
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/admin/projects/${p.id}`}
              className="glass group flex items-center gap-4 rounded-2xl p-4 transition-transform hover:-translate-y-0.5"
            >
              <div
                className="h-16 w-24 shrink-0 rounded-xl bg-cover bg-center bg-ink/5"
                style={p.coverImageUrl ? { backgroundImage: `url(${p.coverImageUrl})` } : undefined}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-medium text-ink">{p.name}</p>
                  <Badge tone={publishTone(p.publishState)}>{p.publishState}</Badge>
                  <Badge tone="neutral">{PIPELINE_LABEL.get(p.pipelineStatus) ?? p.pipelineStatus}</Badge>
                </div>
                <p className="mt-1 truncate text-sm text-ink/50">
                  {p.clientName} {p.location ? `· ${p.location}` : ""}
                </p>
              </div>
              <div className="hidden shrink-0 text-right text-xs text-ink/40 sm:block">
                <p>{p._count.approvals} approvals</p>
                <p className="mt-0.5">{p._count.comments} comments</p>
              </div>
              <div className="shrink-0 text-xs text-ink/40">Updated {formatDate(p.updatedAt)}</div>
              <ArrowRight size={16} className="shrink-0 text-ink/25 transition-transform group-hover:translate-x-1" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
