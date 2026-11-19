import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell } from "lucide-react";
import { getSessionEmployee } from "@/lib/employee-session";
import { getEmployeeBadges } from "@/lib/employee-badges";
import { avatarUrl } from "@/lib/avatar";
import { getTimezone } from "@/lib/settings";
import { EmployeeNav } from "@/components/employee/employee-nav";
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
  const timezone = await getTimezone();
  const today = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    // Calls ring on every page of the portal, and a call keeps going while you move between them.
    <CallProvider side="EMPLOYEE">
    {/* Design 2 (chosen 2026-11-19): no side rail. A slim header across the
        top at every width — the mark, today's date on a desk, the bell and
        your face — and the floating dock at the foot (employee-nav.tsx). */}
      <div className="employee-shell flex overflow-hidden bg-background">
        {/* min-w-0 lets this column be narrower than its widest child — without
          it one wide table stretches the column past the screen and the right
          of the page is cut off, which is what happened to the admin. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* pt-[safe-area-inset-top]: the app draws under the status bar on a
            notched phone, so the header reserves that height itself rather than
            letting the title sit beneath the clock. */}
          <header className="employee-header shrink-0 pt-[env(safe-area-inset-top)]">
            <div className="flex w-full items-center gap-4 px-4 py-3 lg:px-8 lg:py-4">
              <Link href="/employee" className="flex items-baseline gap-3">
                <span className="wordmark-warm font-display text-lg font-bold tracking-[0.06em] lg:text-xl">
                  NEON<span className="text-clay">.</span>
                </span>
                <span className="hidden text-sm text-ink/55 sm:inline">{today}</span>
              </Link>

              <div className="ml-auto flex items-center gap-2">
                <Link
                  href="/employee/notifications"
                  aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
                  className="lq-pill relative flex h-10 items-center gap-1.5 rounded-full px-3 text-sm text-ink/70 transition-colors hover:text-ink"
                >
                  <Bell size={18} strokeWidth={1.85} />
                  {unread > 0 && <span className="font-semibold text-ink">{unread > 99 ? "99+" : unread}</span>}
                </Link>
                <Link
                  href="/employee/profile"
                  aria-label="Your profile"
                  className="rounded-full ring-2 ring-clay/60 ring-offset-2 ring-offset-paper transition-shadow hover:ring-clay"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a face from our own /api/avatar or upload, sized here */}
                  <img
                    src={employee.photoUrl ?? avatarUrl(employee.name, employee.color)}
                    alt=""
                    width={36}
                    height={36}
                    className="h-9 w-9 rounded-full object-cover"
                  />
                </Link>
              </div>
            </div>
          </header>

          {/* The only part that scrolls. A page that fills the frame — the chat —
            turns this off and manages its own scrolling, through
            `.employee-main:has(> .fills-frame)`. That selector matches a
            **direct** child, so the width lives on this element rather than on
            a centring wrapper inside it: adding that wrapper would quietly stop
            the chat filling the screen. */}
        <main className="employee-main mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 pb-4 pt-2 lg:max-w-5xl lg:px-8 lg:pb-6 lg:pt-3">
          {children}
        </main>

        <EmployeeNav
          unreadChat={unreadChat}
          canReadWhatsApp={employee.canReadWhatsApp}
          canUseLeadFinder={employee.canUseLeadFinder}
        />
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
