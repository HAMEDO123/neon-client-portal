import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { recentAdminAlerts } from "@/lib/admin-notifications";
import { clearAdminAlerts } from "@/lib/actions/admin-alert-actions";
import { getTimezone } from "@/lib/settings";
import { formatDayIn, formatTimeIn } from "@/lib/time";
import { dotTone } from "@/lib/task-board";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

// What the team has been doing, newest first.
//
// This is the manager's side of the notification system: an employee starting
// a task, finishing one, asking for supplies. It updates itself — the page is
// inside the admin shell, which holds the live connection open.
export default async function AlertsPage() {
  const alerts = await recentAdminAlerts();
  const timezone = await getTimezone();
  const unread = alerts.filter((alert) => !alert.readAt).length;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Activity</h1>
          <p className="mt-1 text-sm text-ink/50">
            Everything your team changes, as it happens.
            {unread > 0 ? ` ${unread} new.` : ""}
          </p>
        </div>

        {unread > 0 && (
          <form action={clearAdminAlerts}>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm font-medium text-ink/70 hover:bg-white"
            >
              <CheckCheck size={15} strokeWidth={2} />
              Mark all read
            </button>
          </form>
        )}
      </div>

      {alerts.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={Bell}
          title="Nothing yet"
          description="Task updates, finished work and supply requests land here the moment they happen."
        />
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {alerts.map((alert) => (
            <li key={alert.id}>
              <Link
                href={alert.url}
                className={cn(
                  "glass flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-white/70",
                  !alert.readAt && "border-l-2 border-l-pink"
                )}
              >
                <span
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    alert.employee ? dotTone(alert.employee.color) : "bg-ink/25"
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{alert.title}</p>
                  <p className="mt-0.5 text-sm text-ink/60">{alert.message}</p>
                  <p className="mt-1 text-[11px] text-ink/35">
                    {formatDayIn(timezone, alert.createdAt)} · {formatTimeIn(timezone, alert.createdAt)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
