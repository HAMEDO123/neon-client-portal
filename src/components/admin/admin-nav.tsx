"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderKanban,
  ListChecks,
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

export function AdminNav() {
  const pathname = usePathname();
  const isDashboard = pathname === "/admin";
  const isTasks = pathname.startsWith("/admin/tasks");
  const isEmployees = pathname.startsWith("/admin/employees");
  const isChat = pathname.startsWith("/admin/chat");
  const isRequests = pathname.startsWith("/admin/requests");
  const isPayroll = pathname.startsWith("/admin/payroll");
  const isSettings = pathname.startsWith("/admin/settings");

  return (
    <nav className="flex h-full flex-col gap-1 p-4">
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
        href="/admin/chat"
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isChat ? "bg-ink text-bg" : "text-ink/60 hover:bg-ink/5 hover:text-ink"
        )}
      >
        <MessagesSquare size={16} strokeWidth={1.75} />
        Team Chat
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
