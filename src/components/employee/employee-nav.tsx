"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ListChecks, MessagesSquare, ShoppingBag, User } from "lucide-react";
import { cn } from "@/lib/utils";

// Five destinations, nothing else. Notifications are not among them: the bell
// in the header already carries the unread count, so a tab for it would be a
// second door to the same room.
// Chat sits at the right-hand end, under the thumb.
const TABS = [
  { href: "/employee", label: "Home", icon: Home, exact: true },
  { href: "/employee/tasks", label: "Tasks", icon: ListChecks, exact: false },
  { href: "/employee/requests", label: "Requests", icon: ShoppingBag, exact: false },
  { href: "/employee/profile", label: "Profile", icon: User, exact: false },
  { href: "/employee/chat", label: "Chat", icon: MessagesSquare, exact: false },
];

export function EmployeeNav({ unreadChat = 0 }: { unreadChat?: number }) {
  const pathname = usePathname();

  return (
    <nav className="employee-tabbar shrink-0 border-t border-ink/8 bg-bg/95 backdrop-blur-lg">
      {/* .employee-tabbar-row keeps it clear of the home indicator (globals.css). */}
      <div className="employee-tabbar-row mx-auto flex w-full max-w-2xl items-stretch justify-around px-2">
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
                {tab.href === "/employee/chat" && unreadChat > 0 && (
                  <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-strong px-1 text-[10px] font-semibold text-white">
                    {unreadChat > 9 ? "9+" : unreadChat}
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
