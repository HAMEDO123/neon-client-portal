"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FolderKanban, Plus, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { logout } from "@/lib/actions/auth-actions";

export function AdminNav() {
  const pathname = usePathname();
  const isDashboard = pathname === "/admin";

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
        href="/admin/projects/new"
        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink"
      >
        <Plus size={16} strokeWidth={1.75} />
        New Project
      </Link>

      <div className="mt-auto flex flex-col gap-1 pt-4">
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
