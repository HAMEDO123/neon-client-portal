"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Home, ListChecks, MessageCircle, MessagesSquare, Radar, ShoppingBag, User } from "lucide-react";
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

/**
 * The company WhatsApp, for the few people who may read it.
 *
 * Kept out of the list above rather than hidden inside the rail, because the
 * question "who sees this" has exactly one answer — `canReadWhatsApp` on the
 * employee — and it is asked in two places. A door drawn for somebody who
 * cannot open it is worse than no door.
 */
export const WHATSAPP_DESTINATION = {
  href: "/employee/whatsapp",
  label: "WhatsApp",
  icon: MessageCircle,
  exact: false,
};

/** Lead Finder, for whoever the manager ticked (`canUseLeadFinder`). */
export const LEAD_FINDER_DESTINATION = {
  href: "/employee/leads",
  label: "Leads",
  icon: Radar,
  exact: false,
};

export function employeeDestinations(canReadWhatsApp: boolean, canUseLeadFinder = false) {
  return [
    ...EMPLOYEE_DESTINATIONS,
    ...(canReadWhatsApp ? [WHATSAPP_DESTINATION] : []),
    ...(canUseLeadFinder ? [LEAD_FINDER_DESTINATION] : []),
  ];
}

export function EmployeeNav({
  unreadChat = 0,
  canReadWhatsApp = false,
  canUseLeadFinder = false,
}: {
  unreadChat?: number;
  canReadWhatsApp?: boolean;
  /** Lead Finder is a desk tool: its button shows from lg up only. */
  canUseLeadFinder?: boolean;
}) {
  const pathname = usePathname();
  const TABS = employeeDestinations(canReadWhatsApp, canUseLeadFinder);

  // The floating dock (design 2, chosen 2026-11-19): one pill of buttons at
  // the foot of every screen, on a phone and on a desk alike — it replaced the
  // side rail and the phone's tab bar. The row itself is transparent and in
  // the flow, so a page that fills the frame (the chat) ends above it rather
  // than under it, and the keyboard rules that hide .employee-tabbar still
  // apply. On a phone only the current button carries its word; on a desk
  // every one does.
  return (
    <nav aria-label="Main" className="employee-tabbar shrink-0 lg:pb-2">
      <div className="employee-tabbar-row flex justify-center px-2 pt-1.5 pb-2.5">
        <div className="employee-dock flex max-w-full items-center rounded-full p-1.5 lg:gap-1">
          {TABS.map((tab) => {
            const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
            const count = tab.href === "/employee/chat" ? unreadChat : 0;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                aria-label={count > 0 ? `${tab.label}, ${count} unread` : tab.label}
                className={cn(
                  "relative flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full text-[13px] font-semibold transition-colors lg:h-12 lg:px-4 lg:text-sm",
                  active
                    ? "bg-clay px-3.5 text-white lg:px-5"
                    : "w-10 text-ink/60 hover:bg-ink/5 hover:text-ink lg:w-auto",
                  tab.href === LEAD_FINDER_DESTINATION.href && "hidden lg:flex"
                )}
              >
                <span className={cn("relative", count > 0 && "lg:mr-2", count > 0 && active && "mr-2")}>
                  <tab.icon size={19} strokeWidth={active ? 2.25 : 1.85} />
                  {count > 0 && (
                    <span className="absolute -right-2.5 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white ring-2 ring-paper">
                      {count > 9 ? "9+" : count}
                    </span>
                  )}
                </span>
                <span className={cn(active ? "inline" : "hidden lg:inline")}>{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
