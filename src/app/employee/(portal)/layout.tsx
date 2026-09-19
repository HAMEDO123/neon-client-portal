import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell } from "lucide-react";
import { getSessionEmployee } from "@/lib/employee-session";
import { getEmployeeBadges } from "@/lib/employee-badges";
import { EmployeeNav } from "@/components/employee/employee-nav";
import { EmployeeRail } from "@/components/employee/employee-rail";
import { AppViewport } from "@/components/employee/app-viewport";
import { LiveSync } from "@/components/live-sync";
import { appVersion } from "@/lib/app-version";
import { SoundCues } from "@/components/sound-cues";
import { DeviceGuard } from "@/components/employee/device-guard";
import { CallProvider } from "@/components/calls/call-provider";

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
    // Calls ring on every page of the portal, and a call keeps going while you move between them.
    <CallProvider side="EMPLOYEE">
    {/* A row, like the admin: the rail on the left at desk widths, and the
        portal itself in the column beside it. On a phone the rail is not
        rendered at all and this is the single column it has always been. */}
    <div className="employee-shell flex overflow-hidden bg-background">
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-rail-line bg-rail lg:block">
        <EmployeeRail
          name={employee.name}
          role={employee.role}
          unread={unread}
          unreadChat={unreadChat}
        />
      </aside>

      {/* min-w-0 lets this column be narrower than its widest child — without
          it one wide table stretches the column past the screen and the right
          of the page is cut off, which is what happened to the admin. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* pt-[safe-area-inset-top]: the app draws under the status bar on a
            notched phone, so the header reserves that height itself rather than
            letting the title sit beneath the clock. Above lg the rail carries
            the mark and the bell instead. */}
        <header className="employee-header shrink-0 border-b border-ink/8 bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur-lg lg:hidden">
          <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 py-3">
            <Link href="/employee" className="flex items-baseline gap-1.5">
              <span className="wordmark-warm font-display text-base font-bold">NEON</span>
              <span className="text-sm font-medium text-ink/60">Tasks</span>
            </Link>

            <Link
              href="/employee/notifications"
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
              className="relative rounded-full p-2 text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink"
            >
              <Bell size={20} strokeWidth={1.75} />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-clay px-1.5 text-[11px] font-semibold text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
          </div>
        </header>

        {/* The only part that scrolls. A page that fills the frame — the chat —
            turns this off and manages its own scrolling, through
            `.employee-main:has(> .fills-frame)`. That selector matches a
            **direct** child, so the width lives on this element rather than on
            a centring wrapper inside it: adding that wrapper would quietly stop
            the chat filling the screen. */}
        <main className="employee-main mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 pb-6 pt-5 lg:max-w-5xl lg:px-8 lg:pb-10 lg:pt-8">
          {children}
        </main>

        <EmployeeNav unreadChat={unreadChat} />
      </div>
      <AppViewport />
      {/* Badges, task states and review outcomes arrive without a reload — and
          a deploy asks for one, because this page belongs to the build before it. */}
      <LiveSync version={appVersion()} />
      {/* One sound for a message, another for everything else. */}
      <SoundCues side="EMPLOYEE" />
      {/* This phone belongs to whoever is signed in on it, not to whoever
          enabled push on it first. */}
      <DeviceGuard />
    </div>
    </CallProvider>
  );
}
