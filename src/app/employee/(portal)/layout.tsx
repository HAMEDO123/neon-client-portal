import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell } from "lucide-react";
import { getSessionEmployee } from "@/lib/employee-session";
import { getEmployeeBadges } from "@/lib/employee-badges";
import { EmployeeNav } from "@/components/employee/employee-nav";
import { AppViewport } from "@/components/employee/app-viewport";
import { LiveSync } from "@/components/live-sync";
import { SoundCues } from "@/components/sound-cues";
import { DeviceGuard } from "@/components/employee/device-guard";

// Server-side gate for the whole portal. Anything under this layout has an
// authenticated, enabled employee behind it — and every action it can reach
// re-checks the session for itself.
//
// The shell is an app frame, not a document: it is exactly as tall as the
// visible screen, the header and tab bar are parts of that frame, and only the
// middle scrolls. That is what stops the tab bar riding up with the keyboard —
// there is no page left to scroll underneath it.
export default async function EmployeePortalLayout({ children }: { children: ReactNode }) {
  const employee = await getSessionEmployee();
  if (!employee) redirect("/employee/login");

  // One query for both badges — this runs on every navigation.
  const { unread, unreadChat } = await getEmployeeBadges(employee.id);

  return (
    <div className="employee-shell flex flex-col overflow-hidden bg-background">
      {/* pt-[safe-area-inset-top]: the app draws under the status bar on a
          notched phone, so the header reserves that height itself rather than
          letting the title sit beneath the clock. */}
      <header className="employee-header shrink-0 border-b border-ink/8 bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur-lg">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 py-3">
          <Link href="/employee" className="flex items-baseline gap-1.5">
            <span className="text-gradient-neon text-base font-bold">NEON</span>
            <span className="text-sm font-medium text-ink/60">Tasks</span>
          </Link>

          <Link
            href="/employee/notifications"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
            className="relative rounded-full p-2 text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <Bell size={20} strokeWidth={1.75} />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-pink px-1.5 text-[11px] font-semibold text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Link>
        </div>
      </header>

      {/* The only part that scrolls. A page that fills the frame — the chat —
          turns this off and manages its own scrolling. */}
      <main className="employee-main mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 pb-6 pt-5">
        {children}
      </main>

      <EmployeeNav unreadChat={unreadChat} />
      <AppViewport />
      {/* Badges, task states and review outcomes arrive without a reload. */}
      <LiveSync />
      {/* One sound for a message, another for everything else. */}
      <SoundCues side="EMPLOYEE" />
      {/* This phone belongs to whoever is signed in on it, not to whoever
          enabled push on it first. */}
      <DeviceGuard />
    </div>
  );
}
