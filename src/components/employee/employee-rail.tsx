"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { EMPLOYEE_DESTINATIONS } from "@/components/employee/employee-nav";
import { SignOutButton } from "@/components/employee/sign-out-button";
import { cn } from "@/lib/utils";

// The portal's rail, for a desk rather than a hand.
//
// The same six destinations the tab bar carries — imported from it, so the two
// cannot drift — in the studio's dark rail, which is the manager's own. On a
// screen this size a bar of six icons across the bottom is a phone control
// stranded on a desktop: the room is on the left, and that is where a mouse
// goes looking.
//
// It exists only above lg. Everything about the phone — the frame glued to the
// visible viewport, the tab bar under the thumb, the header carrying the
// notification bell — is untouched below that width.

export function EmployeeRail({
  name,
  role,
  unread = 0,
  unreadChat = 0,
}: {
  name: string;
  role: string | null;
  /** Unread notifications, shown on the bell at the foot. */
  unread?: number;
  unreadChat?: number;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex min-h-full flex-col gap-0.5 p-4">
      <Link href="/employee" className="mb-6 block px-3 pt-1">
        <span className="block font-display text-xl font-semibold leading-none text-rail-ink">NEON</span>
        <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.28em] text-clay">Tasks</span>
      </Link>

      {EMPLOYEE_DESTINATIONS.map((destination) => {
        const active = destination.exact
          ? pathname === destination.href
          : pathname.startsWith(destination.href);

        return (
          <Item
            key={destination.href}
            href={destination.href}
            active={active}
            icon={<destination.icon size={16} strokeWidth={1.75} />}
            count={destination.href === "/employee/chat" ? unreadChat : 0}
          >
            {destination.label}
          </Item>
        );
      })}

      <div className="mt-auto flex flex-col gap-0.5 pt-4">
        {/* Who is signed in. On a shared studio machine this is the difference
            between adding a photo as yourself and adding it as whoever used it
            last, so it is said plainly rather than left to be assumed. */}
        <div className="mb-3 rounded-2xl border border-rail-line bg-rail-soft px-3 py-3">
          <span className="block truncate text-sm font-semibold text-rail-ink">{name}</span>
          <span className="mt-0.5 block truncate text-[11px] text-rail-dim">{role ?? "Team"}</span>
        </div>

        <Item
          href="/employee/notifications"
          active={pathname.startsWith("/employee/notifications")}
          icon={<Bell size={16} strokeWidth={1.75} />}
          count={unread}
        >
          Notifications
        </Item>

        {/* The portal's own sign-out, not a second copy of it: signing out has
            to give up this device's push subscription as well as the session,
            or the phone keeps delivering the last person's notifications. */}
        <div className="mt-2 px-1">
          <SignOutButton variant="rail" />
        </div>

        <p className="mt-3 px-3 text-[10px] uppercase tracking-[0.22em] text-rail-dim/50">Design · Build · Inspire</p>
      </div>
    </nav>
  );
}

/** One destination in the rail: clay where you are, quiet everywhere else. */
function Item({
  href,
  active,
  icon,
  count = 0,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-clay text-white shadow-[0_10px_20px_-14px_rgba(0,0,0,0.9)]"
          : "text-rail-dim hover:bg-rail-soft hover:text-rail-ink"
      )}
    >
      {icon}
      {children}
      {count > 0 && (
        <span
          className={cn(
            "ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold",
            // On the clay row the pill inverts rather than disappearing into it.
            active ? "bg-white/25 text-white" : "bg-clay text-white"
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
