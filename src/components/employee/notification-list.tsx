"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BellRing,
  CalendarClock,
  CheckCheck,
  ClipboardList,
  Info,
  MessageSquare,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/actions/employee-actions";
import type { NotificationType } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

export type NotificationRow = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  url: string | null;
  readAt: Date | null;
  createdAt: Date;
};

const ICONS: Record<NotificationType, typeof BellRing> = {
  TASK_ASSIGNED: ClipboardList,
  TASK_UPDATED: RefreshCw,
  TASK_TODAY_SCHEDULE: ClipboardList,
  TASK_TOMORROW_SCHEDULE: CalendarClock,
  TASK_DEADLINE_REMINDER: BellRing,
  CHAT_MESSAGE: MessageSquare,
  SYSTEM_NOTIFICATION: Info,
  WARNING: TriangleAlert,
};

function ago(date: Date) {
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export function NotificationList({ notifications }: { notifications: NotificationRow[] }) {
  const [, startTransition] = useTransition();
  const router = useRouter();

  const unread = notifications.filter((n) => !n.readAt).length;

  // Opening a notification marks it read and follows it to whatever it is
  // about — the destination was resolved when the notification was created.
  function open(notification: NotificationRow) {
    startTransition(async () => {
      if (!notification.readAt) await markNotificationRead(notification.id);
      if (notification.url) router.push(notification.url);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink/50">
          {unread === 0 ? "All caught up" : `${unread} unread`}
        </p>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => startTransition(() => markAllNotificationsRead())}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink/12 bg-white/60 px-3 py-1.5 text-xs font-medium text-ink/60 hover:text-ink"
          >
            <CheckCheck size={13} strokeWidth={2} />
            Mark all as read
          </button>
        )}
      </div>

      {notifications.map((notification) => {
        const Icon = ICONS[notification.type] ?? Info;
        const isUnread = !notification.readAt;
        return (
          <button
            key={notification.id}
            type="button"
            onClick={() => open(notification)}
            className={cn(
              "flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors active:scale-[0.99]",
              isUnread
                ? "border-cyan/25 bg-cyan/[0.06]"
                : "border-ink/8 bg-white/50"
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                isUnread ? "bg-cyan/15 text-cyan-strong" : "bg-ink/5 text-ink/40"
              )}
            >
              <Icon size={16} strokeWidth={2} />
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className={cn("text-sm", isUnread ? "font-semibold text-ink" : "font-medium text-ink/70")}>
                  {notification.title}
                </span>
                {isUnread && <span className="h-2 w-2 shrink-0 rounded-full bg-cyan" />}
              </span>
              <span className="mt-0.5 block text-sm text-ink/60">{notification.message}</span>
              <span className="mt-1.5 block text-[11px] text-ink/35">{ago(notification.createdAt)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
