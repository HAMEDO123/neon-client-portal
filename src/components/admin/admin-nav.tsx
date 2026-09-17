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
  Fingerprint,
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

// The studio's own rail: the mark at the top, everywhere the manager works in
// the middle, and the account at the foot. Near-black and warm rather than
// blue-black, on its own --rail tokens so the contrast is decided once.
//
// The destinations are this platform's real pages and nothing else. Where a
// design asks for a door that opens onto nothing, the door is left out — and
// the ones that carry real counts (Requests, Payroll, Activity) stay, as does
// Sign out, which is the only way off the desk.

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
  const isAttendance = pathname.startsWith("/admin/attendance");
  const isSettings = pathname.startsWith("/admin/settings");

  return (
    <nav className="flex min-h-full flex-col gap-0.5 p-4">
      <Link href="/admin" className="mb-6 block px-3 pt-1">
        <span className="block font-display text-xl font-semibold leading-none text-rail-ink">NEON</span>
        <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.28em] text-clay">
          Interior Design
        </span>
        <span className="mt-2 block text-[11px] uppercase tracking-[0.12em] text-rail-dim">
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
        Team
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
      <Item href="/admin/attendance" active={isAttendance} icon={<Fingerprint size={16} strokeWidth={1.75} />}>
        Attendance
      </Item>
      <Item href="/admin/projects/new" active={false} icon={<Plus size={16} strokeWidth={1.75} />}>
        New Project
      </Item>

      <div className="mt-auto flex flex-col gap-0.5 pt-4">
        <TeamBox count={badges?.team ?? 0} />

        <Item href="/admin/settings" active={isSettings} icon={<Settings size={16} strokeWidth={1.75} />}>
          Settings
        </Item>
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-rail-dim transition-colors hover:bg-rail-soft hover:text-rail-ink"
          >
            <LogOut size={16} strokeWidth={1.75} />
            Sign out
          </button>
        </form>
        <p className="mt-3 px-3 text-[10px] uppercase tracking-[0.22em] text-rail-dim/50">Design · Build · Inspire</p>
      </div>
    </nav>
  );
}

/**
 * How many people the studio has, and the way to them.
 *
 * A real count of active employees, not a seat allowance: there is no plan
 * here, nothing is limited by this number, and there is nothing to upgrade to.
 */
function TeamBox({ count }: { count: number }) {
  return (
    <Link
      href="/admin/employees"
      className="mb-3 block rounded-2xl border border-rail-line bg-rail-soft px-3 py-3 transition-colors hover:border-clay/40"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rail-dim">The team</span>
        <span className="text-sm font-semibold tabular-nums text-rail-ink">{count}</span>
      </span>
      <span className="mt-2 flex items-center gap-1" aria-hidden>
        {Array.from({ length: Math.min(count, 8) }).map((_, index) => (
          <span key={index} className="h-1.5 w-1.5 rounded-full bg-clay" />
        ))}
        {count === 0 && <span className="text-[11px] text-rail-dim">Nobody yet</span>}
      </span>
      <span className="mt-2 block text-[11px] text-rail-dim">
        {count === 1 ? "1 person on the team" : `${count} people on the team`}
      </span>
    </Link>
  );
}

/** One destination in the rail: clay where you are, quiet everywhere else. */
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
        active
          ? "bg-clay text-white shadow-[0_10px_20px_-14px_rgba(0,0,0,0.9)]"
          : "text-rail-dim hover:bg-rail-soft hover:text-rail-ink"
      )}
    >
      {icon}
      {children}
      {count > 0 && (
        <span
          className={cn(
            "ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold",
            // On the clay row the pill inverts rather than disappearing into it.
            active ? "bg-white/25 text-white" : "bg-clay text-white"
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
