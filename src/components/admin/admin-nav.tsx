"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderKanban,
  ListChecks,
  ClipboardCheck,
  ChartNoAxesColumn,
  Bell,
  Users,
  MessagesSquare,
  ShoppingBag,
  Wallet,
  Settings,
  Plus,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { logout } from "@/lib/actions/auth-actions";
import type { AdminBadges } from "@/lib/admin-badges";

export function AdminNav({ badges }: { badges?: AdminBadges }) {
  const pathname = usePathname();
  const isDashboard = pathname === "/admin";
  const isTasks = pathname.startsWith("/admin/tasks");
  const isReviews = pathname.startsWith("/admin/reviews");
  const isAnalytics = pathname.startsWith("/admin/analytics");
  const isAlerts = pathname.startsWith("/admin/alerts");
  const isEmployees = pathname.startsWith("/admin/employees");
  const isChat = pathname.startsWith("/admin/chat");
  const isRequests = pathname.startsWith("/admin/requests");
  const isPayroll = pathname.startsWith("/admin/payroll");
  const isSettings = pathname.startsWith("/admin/settings");

  return (
    <nav className="flex min-h-full flex-col gap-1 p-4">
      <Link href="/admin" className="mb-6 px-2">
        <span className="text-gradient-neon text-base font-bold">NEON</span>
        <span className="ml-1.5 text-sm font-medium text-ink/60">Admin</span>
      </Link>

      <Link
        href="/admin"
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isDashboard ? "bg-ink text-bg" : "text-ink/60 hover:bg-ink/5 hover:text-ink"
        )}
      >
        <LayoutDashboard size={16} strokeWidth={1.75} />
        Dashboard
      </Link>
      <Link
        href="/admin"
        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink"
      >
        <FolderKanban size={16} strokeWidth={1.75} />
        All Projects
      </Link>
      <Link
        href="/admin/tasks"
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isTasks ? "bg-ink text-bg" : "text-ink/60 hover:bg-ink/5 hover:text-ink"
        )}
      >
        <ListChecks size={16} strokeWidth={1.75} />
        Tasks
      </Link>
      <Link
        href="/admin/reviews"
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isReviews ? "bg-ink text-bg" : "text-ink/60 hover:bg-ink/5 hover:text-ink"
        )}
      >
        <ClipboardCheck size={16} strokeWidth={1.75} />
        Reviews
        <Badge count={badges?.reviews ?? 0} active={isReviews} />
      </Link>
      <Link
        href="/admin/analytics"
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isAnalytics ? "bg-ink text-bg" : "text-ink/60 hover:bg-ink/5 hover:text-ink"
        )}
      >
        <ChartNoAxesColumn size={16} strokeWidth={1.75} />
        Analytics
      </Link>
      <Link
        href="/admin/alerts"
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isAlerts ? "bg-ink text-bg" : "text-ink/60 hover:bg-ink/5 hover:text-ink"
        )}
      >
        <Bell size={16} strokeWidth={1.75} />
        Activity
        <Badge count={badges?.alerts ?? 0} active={isAlerts} />
      </Link>
      <Link
        href="/admin/chat"
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isChat ? "bg-ink text-bg" : "text-ink/60 hover:bg-ink/5 hover:text-ink"
        )}
      >
        <MessagesSquare size={16} strokeWidth={1.75} />
        Team Chat
        <Badge count={badges?.chat ?? 0} active={isChat} />
      </Link>
      <Link
        href="/admin/employees"
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isEmployees ? "bg-ink text-bg" : "text-ink/60 hover:bg-ink/5 hover:text-ink"
        )}
      >
        <Users size={16} strokeWidth={1.75} />
        Employees
      </Link>
      <Link
        href="/admin/requests"
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isRequests ? "bg-ink text-bg" : "text-ink/60 hover:bg-ink/5 hover:text-ink"
        )}
      >
        <ShoppingBag size={16} strokeWidth={1.75} />
        Requests
        <Badge count={badges?.requests ?? 0} active={isRequests} />
      </Link>
      <Link
        href="/admin/payroll"
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isPayroll ? "bg-ink text-bg" : "text-ink/60 hover:bg-ink/5 hover:text-ink"
        )}
      >
        <Wallet size={16} strokeWidth={1.75} />
        Payroll
      </Link>
      <Link
        href="/admin/projects/new"
        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink"
      >
        <Plus size={16} strokeWidth={1.75} />
        New Project
      </Link>

      <div className="mt-auto flex flex-col gap-1 pt-4">
        <Link
          href="/admin/settings"
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            isSettings ? "bg-ink text-bg" : "text-ink/60 hover:bg-ink/5 hover:text-ink"
          )}
        >
          <Settings size={16} strokeWidth={1.75} />
          Settings
        </Link>
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <LogOut size={16} strokeWidth={1.75} />
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}

/** The count beside a link: how many are waiting, and nothing when none are. */
function Badge({ count, active }: { count: number; active: boolean }) {
  if (count <= 0) return null;

  return (
    <span
      className={cn(
        "ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold",
        // On the selected row the pill sits on a dark background, so it
        // inverts rather than disappearing into it.
        active ? "bg-bg/20 text-bg" : "bg-pink text-white"
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
