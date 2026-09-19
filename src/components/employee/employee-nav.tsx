"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Home, ListChecks, MessagesSquare, ShoppingBag, User } from "lucide-react";
import { cn } from "@/lib/utils";

// Six destinations. This said five for a long time, and the sixth was added
// deliberately rather than drifted into: employees now put drawings, documents
// and photos onto projects themselves, and work you can do needs a door of its
// own — reaching it through a task would only be findable while a task happened
// to point at that project.
//
// Notifications are still not among them: the bell in the header already
// carries the unread count, so a tab for it would be a second door to the same
// room. Chat stays at the right-hand end, under the thumb.
//
// Exported because the desktop rail shows the same destinations standing up
// that this shows lying down. Two lists would be two things to keep in step,
// and the one that drifts is always the one nobody is looking at.
export const EMPLOYEE_DESTINATIONS = [
  { href: "/employee", label: "Home", icon: Home, exact: true },
  { href: "/employee/tasks", label: "Tasks", icon: ListChecks, exact: false },
  { href: "/employee/projects", label: "Projects", icon: Building2, exact: false },
  { href: "/employee/requests", label: "Requests", icon: ShoppingBag, exact: false },
  { href: "/employee/profile", label: "Profile", icon: User, exact: false },
  { href: "/employee/chat", label: "Chat", icon: MessagesSquare, exact: false },
];

const TABS = EMPLOYEE_DESTINATIONS;

export function EmployeeNav({ unreadChat = 0 }: { unreadChat?: number }) {
  const pathname = usePathname();

  return (
    // Thumb-reach on a phone; on a desktop the same destinations are in the
    // rail down the left, where a mouse expects them.
    <nav className="employee-tabbar shrink-0 border-t border-ink/8 bg-bg/95 backdrop-blur-lg lg:hidden">
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
                  <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-clay px-1 text-[10px] font-semibold text-white">
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
