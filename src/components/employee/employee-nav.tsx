"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Home, ListChecks, User } from "lucide-react";
import { cn } from "@/lib/utils";

// Four destinations, nothing else. An employee should never have to decide
// which part of the platform they are supposed to be in.
const TABS = [
  { href: "/employee", label: "Home", icon: Home, exact: true },
  { href: "/employee/tasks", label: "Tasks", icon: ListChecks, exact: false },
  { href: "/employee/notifications", label: "Alerts", icon: Bell, exact: false },
  { href: "/employee/profile", label: "Profile", icon: User, exact: false },
];

export function EmployeeNav({ unread }: { unread: number }) {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-ink/8 bg-bg/95 backdrop-blur-lg">
      <div className="mx-auto flex w-full max-w-2xl items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom)]">
        {TABS.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors",
                active ? "text-ink" : "text-ink/45"
              )}
            >
              <span className="relative">
                <tab.icon size={21} strokeWidth={active ? 2.25 : 1.75} />
                {tab.href === "/employee/notifications" && unread > 0 && (
                  <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-pink px-1 text-[10px] font-semibold text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </span>
              {tab.label}
              {active && <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-ink" />}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
