import { notFound } from "next/navigation";
import { Eye, Image as ImageIcon, Download, CheckCircle2, MessageSquare, Activity } from "lucide-react";
import { getProjectById, getProjectAnalytics } from "@/lib/queries";
import { EmptyState } from "@/components/ui/empty-state";
import { activityLabel } from "@/lib/activity-labels";
import { formatDate } from "@/lib/format";

function timeAgo(date: Date) {
  const diffMs = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(date);
}

export default async function AnalyticsAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  const analytics = await getProjectAnalytics(id);

  const cards = [
    { label: "Project Opens", value: analytics.views, icon: Eye },
    { label: "Renders Viewed", value: analytics.renderViews, icon: ImageIcon },
    { label: "Downloads", value: analytics.downloads, icon: Download },
    { label: "Approval Responses", value: analytics.approvals, icon: CheckCircle2 },
    { label: "Comments", value: analytics.comments, icon: MessageSquare },
  ];

  const maxCount = Math.max(...analytics.byType.map((b) => b._count.type), 1);

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="glass rounded-2xl p-4">
            <c.icon size={16} strokeWidth={1.75} className="text-cyan-strong" />
            <p className="mt-3 text-2xl font-semibold text-ink">{c.value}</p>
            <p className="mt-1 text-xs text-ink/50">{c.label}</p>
          </div>
        ))}
      </div>

      {analytics.totalEvents === 0 ? (
        <EmptyState
          icon={Activity}
          title="No client activity yet"
          description="Once the client opens their project link, their activity will appear here."
        />
      ) : (
        <>
          <div>
            <h3 className="text-sm font-medium uppercase tracking-wider text-ink/40">Activity Breakdown</h3>
            <div className="mt-4 flex flex-col gap-3">
              {analytics.byType
                .sort((a, b) => b._count.type - a._count.type)
                .map((b) => (
                  <div key={b.type}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-ink/70">{activityLabel(b.type)}</span>
                      <span className="font-medium text-ink">{b._count.type}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/6">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-strong to-purple-strong"
                        style={{ width: `${(b._count.type / maxCount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium uppercase tracking-wider text-ink/40">Recent Activity</h3>
            <div className="mt-4 flex flex-col gap-1.5">
              {analytics.recent.map((a) => (
                <div key={a.id} className="glass flex items-center justify-between rounded-xl px-4 py-2.5 text-sm">
                  <span className="text-ink/70">
                    {activityLabel(a.type)}
                    {a.detail && <span className="text-ink/40"> — {a.detail}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-ink/35">{timeAgo(a.createdAt)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
