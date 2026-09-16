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

// The studio's own sidebar: the mark at the top, everywhere the manager works
// in the middle, and the account at the foot. The warm palette is the studio's
// (see the tokens in globals.css); the destinations are this platform's real
// pages and nothing else.

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
    <nav className="flex min-h-full flex-col gap-0.5 p-4">
      <Link href="/admin" className="mb-6 block px-3 pt-1">
        <span className="block font-display text-xl font-semibold leading-none text-bark">NEON</span>
        <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.28em] text-clay-deep">
          Interior Design
        </span>
        <span className="mt-2 block text-[11px] uppercase tracking-[0.12em] text-bark/35">
          Spaces for a better life
        </span>
      </Link>

      <Item href="/admin" active={isDashboard} icon={<LayoutDashboard size={16} strokeWidth={1.75} />}>
        Dashboard
      </Item>
      <Item href="/admin" active={false} icon={<FolderKanban size={16} strokeWidth={1.75} />}>
        All Projects
      </Item>
      <Item href="/admin/tasks" active={isTasks} icon={<ListChecks size={16} strokeWidth={1.75} />}>
        Tasks
      </Item>
      <Item
        href="/admin/reviews"
        active={isReviews}
        icon={<ClipboardCheck size={16} strokeWidth={1.75} />}
        count={badges?.reviews ?? 0}
      >
        Reviews
      </Item>
      <Item href="/admin/analytics" active={isAnalytics} icon={<ChartNoAxesColumn size={16} strokeWidth={1.75} />}>
        Analytics
      </Item>
      <Item href="/admin/alerts" active={isAlerts} icon={<Bell size={16} strokeWidth={1.75} />} count={badges?.alerts ?? 0}>
        Activity
      </Item>
      <Item href="/admin/chat" active={isChat} icon={<MessagesSquare size={16} strokeWidth={1.75} />} count={badges?.chat ?? 0}>
        Chat
      </Item>
      <Item href="/admin/employees" active={isEmployees} icon={<Users size={16} strokeWidth={1.75} />}>
        Employees
      </Item>
      <Item
        href="/admin/requests"
        active={isRequests}
        icon={<ShoppingBag size={16} strokeWidth={1.75} />}
        count={badges?.requests ?? 0}
      >
        Requests
      </Item>
      <Item href="/admin/payroll" active={isPayroll} icon={<Wallet size={16} strokeWidth={1.75} />}>
        Payroll
      </Item>
      <Item href="/admin/projects/new" active={false} icon={<Plus size={16} strokeWidth={1.75} />}>
        New Project
      </Item>

      <div className="mt-auto flex flex-col gap-0.5 pt-4">
        <Item href="/admin/settings" active={isSettings} icon={<Settings size={16} strokeWidth={1.75} />}>
          Settings
        </Item>
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-bark/45 transition-colors hover:bg-clay-soft/60 hover:text-bark"
          >
            <LogOut size={16} strokeWidth={1.75} />
            Sign out
          </button>
        </form>
        <p className="mt-3 px-3 text-[10px] uppercase tracking-[0.22em] text-bark/25">Design · Build · Inspire</p>
      </div>
    </nav>
  );
}

/** One destination in the sidebar: tan where you are, quiet everywhere else. */
function Item({
  href,
  active,
  icon,
  count = 0,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  /** How many are waiting behind this link; nothing is shown when none are. */
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
        active ? "bg-clay text-white shadow-[0_10px_20px_-14px_rgba(141,108,74,0.9)]" : "text-bark/60 hover:bg-clay-soft/60 hover:text-bark"
      )}
    >
      {icon}
      {children}
      {count > 0 && (
        <span
          className={cn(
            "ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold",
            // On the tan row the pill inverts rather than disappearing into it.
            active ? "bg-white/25 text-white" : "bg-clay-soft text-clay-deep"
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
