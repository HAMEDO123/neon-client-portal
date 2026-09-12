"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronRight, Home, Menu, X } from "lucide-react";
import { AdminNav } from "@/components/admin/admin-nav";
import { LiveSync } from "@/components/live-sync";
import { SoundCues } from "@/components/sound-cues";
import { AppViewport } from "@/components/employee/app-viewport";
import { isConversationPath } from "@/lib/chat-conversations";
import type { AdminBadges } from "@/lib/admin-badges";
import { cn } from "@/lib/utils";

// The sidebar layout only works at desktop widths — on a phone (the iOS
// sideload wrapper, or just Safari) a fixed 256px sidebar eats most of the
// screen and crushes the content next to it. Below lg, swap it for a top bar
// + slide-in drawer instead.

/** What the breadcrumb calls each section — the sidebar's own words. */
const PAGE_NAMES: Record<string, string> = {
  tasks: "Tasks",
  reviews: "Reviews",
  analytics: "Analytics",
  alerts: "Activity",
  chat: "Chat",
  employees: "Employees",
  requests: "Requests",
  payroll: "Payroll",
  settings: "Settings",
  projects: "Projects",
};

function pageName(pathname: string) {
  const section = pathname.split("/")[2];
  if (!section) return "Dashboard";
  return PAGE_NAMES[section] ?? "Projects";
}
export function AdminShell({
  children,
  badges,
}: {
  children: ReactNode;
  badges?: AdminBadges;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Forms and lists read better in a narrow column, but the task board is a
  // matrix — it gets the whole window so it fits without sideways scrolling.
  const wide = pathname.startsWith("/admin/tasks");

  // An open conversation fills the window and scrolls inside itself, the way
  // a messaging app does; every other page scrolls as a page.
  const fill = isConversationPath(pathname);

  // On a phone the counts sit inside the closed menu, so the menu button
  // carries a dot when anything is waiting.
  const waiting =
    (badges?.reviews ?? 0) + (badges?.alerts ?? 0) + (badges?.chat ?? 0) + (badges?.requests ?? 0) > 0;

  // The sidebar is part of the window, not part of the page: it stays put
  // while the content scrolls, the way a desktop app behaves. The window is
  // the part of the screen you can see (.admin-shell, sized by AppViewport),
  // not 100vh: on an iPhone 100vh runs on under Safari's toolbar and under the
  // keyboard, which is where the message box went the moment you typed.
  return (
    <div className="admin-shell flex overflow-hidden bg-background">
      {/* Board, badges and review queue stay current on their own. */}
      <LiveSync />
      {/* One sound for a message, another for everything else. */}
      <SoundCues side="ADMIN" />
      {/* Sizes the frame to what is visible, so the keyboard never covers a message box. */}
      <AppViewport />
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-ink/8 bg-white/40 lg:block">
        <AdminNav badges={badges} />
      </aside>

      {/* min-w-0 lets this column be narrower than its widest child. Without
          it one wide table stretched the column past the screen, and the right
          side of the page — the menu button with it — was cut off. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="admin-topbar flex items-center justify-between border-b border-ink/8 bg-white/60 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:hidden">
          <span className="text-base font-bold">
            <span className="text-gradient-neon">NEON</span>
            <span className="ml-1.5 text-sm font-medium text-ink/60">Admin</span>
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={waiting ? "Open menu, something is waiting" : "Open menu"}
            className="relative rounded-lg p-2 text-ink/60 hover:bg-ink/5"
          >
            <Menu size={20} />
            {waiting && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-pink ring-2 ring-white" aria-hidden />
            )}
          </button>
        </div>

        {/* The desktop bar: where you are, what is waiting, and the account you
            are signed in as. The phone keeps its own compact bar above. */}
        <div className="hidden items-center gap-4 border-b border-ink/8 bg-white/60 px-8 py-3 lg:flex">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm text-ink/45">
            <Link href="/admin" aria-label="Dashboard" className="rounded-md p-1 transition-colors hover:bg-ink/5 hover:text-ink">
              <Home size={15} strokeWidth={1.75} />
            </Link>
            <ChevronRight size={13} strokeWidth={2} className="text-ink/25" />
            <span>Workspace</span>
            <ChevronRight size={13} strokeWidth={2} className="text-ink/25" />
            <span className="truncate font-medium text-ink">{pageName(pathname)}</span>
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Link
              href="/admin/alerts"
              aria-label={(badges?.alerts ?? 0) > 0 ? `Activity, ${badges?.alerts} waiting` : "Activity"}
              className="relative rounded-lg p-2 text-ink/50 transition-colors hover:bg-ink/5 hover:text-ink"
            >
              <Bell size={18} strokeWidth={1.75} />
              {(badges?.alerts ?? 0) > 0 && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-pink ring-2 ring-white" aria-hidden />
              )}
            </Link>

            <Link
              href="/admin/settings"
              className="flex items-center gap-2.5 rounded-full border border-ink/10 bg-white/70 py-1 pl-1 pr-3 transition-colors hover:bg-white"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-xs font-semibold text-bg">
                N
              </span>
              <span className="text-left leading-tight">
                <span className="block text-xs font-semibold text-ink">NEON</span>
                <span className="block text-[11px] text-ink/45">Admin</span>
              </span>
            </Link>
          </div>
        </div>

        <main
          className={cn(
            "flex-1",
            fill
              ? "min-h-0 overflow-hidden"
              : "overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 lg:px-8 lg:pb-10 lg:pt-10"
          )}
        >
          <div className={cn("mx-auto", fill ? "h-full" : wide ? "max-w-none" : "max-w-5xl")}>{children}</div>
        </main>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/40"
          />
          {/* The panel scrolls, so Sign out at the foot of the list is
              reachable on a short screen. */}
          <div
            className="absolute inset-y-0 left-0 w-72 max-w-[80vw] overflow-y-auto bg-bg pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-xl"
            onClick={() => setOpen(false)}
          >
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] rounded-lg p-2 text-ink/60 hover:bg-ink/5"
            >
              <X size={20} />
            </button>
            <AdminNav badges={badges} />
          </div>
        </div>
      )}
    </div>
  );
}
