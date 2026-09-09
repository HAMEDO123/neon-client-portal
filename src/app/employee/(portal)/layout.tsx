import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell } from "lucide-react";
import { getSessionEmployee } from "@/lib/employee-session";
import { getEmployeeBadges } from "@/lib/employee-badges";
import { EmployeeNav } from "@/components/employee/employee-nav";
import { KeyboardInset } from "@/components/employee/keyboard-inset";

// Server-side gate for the whole portal. Anything under this layout has an
// authenticated, enabled employee behind it — and every action it can reach
// re-checks the session for itself.
export default async function EmployeePortalLayout({ children }: { children: ReactNode }) {
  const employee = await getSessionEmployee();
  if (!employee) redirect("/employee/login");

  // One query for both badges — this runs on every navigation.
  const { unread, unreadChat } = await getEmployeeBadges(employee.id);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* pt-[safe-area-inset-top]: the app draws under the status bar on a
          notched phone, so the header reserves that height itself rather than
          letting the title sit beneath the clock. */}
      <header className="sticky top-0 z-30 border-b border-ink/8 bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur-lg">
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

      {/* Bottom padding clears the fixed tab bar, including the iPhone home indicator. */}
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-32 pt-5">{children}</main>

      <EmployeeNav unreadChat={unreadChat} />
      <KeyboardInset />
    </div>
  );
}
