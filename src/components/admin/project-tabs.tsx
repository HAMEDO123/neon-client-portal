"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "", label: "Overview" },
  { key: "gallery", label: "Gallery" },
  { key: "drawings", label: "Drawings" },
  { key: "boq", label: "BOQ" },
  { key: "pricing", label: "Pricing" },
  { key: "materials", label: "Materials" },
  { key: "furniture", label: "Furniture" },
  { key: "documents", label: "Documents" },
  { key: "approvals", label: "Approvals" },
  { key: "comments", label: "Comments" },
  { key: "analytics", label: "Analytics" },
];

export function ProjectTabs({
  projectId,
  // Which portal is drawing them. The same tabs serve both, and the only thing
  // that differs is where they point — so a hard-coded "/admin" here would send
  // an employee to a page their session cannot open.
  portal = "/admin",
  className,
}: {
  projectId: string;
  portal?: "/admin" | "/employee";
  className?: string;
}) {
  const pathname = usePathname();
  const base = `${portal}/projects/${projectId}`;
  const rail = useRef<HTMLDivElement>(null);

  // Eleven tabs do not always fit, and the rail scrolls sideways when they do
  // not. That was built for a thumb: the scrollbar is hidden, and with a mouse
  // there was then nothing to drag and a wheel that only goes up and down — so
  // on a desk the last tab was simply out of reach, with nothing to say it was
  // there. Three things fix it without changing the phone:
  //
  //   the wheel moves the rail sideways while the pointer is over it;
  //   the tab being looked at is brought into view, so opening Analytics from
  //   a link does not leave it hidden past the edge;
  //   and with a mouse the scrollbar is drawn (`scrollbar-touch-none`).
  useEffect(() => {
    const el = rail.current;
    if (!el) return;

    // A native listener, because React's own wheel handler is passive and
    // cannot stop the page from scrolling down at the same time.
    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      // A trackpad already swiping sideways is left alone.
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

      const before = el.scrollLeft;
      el.scrollLeft += event.deltaY;
      // At either end the wheel goes back to the page, so the rail never traps it.
      if (el.scrollLeft !== before) event.preventDefault();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    rail.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  return (
    <div
      ref={rail}
      className={cn("scrollbar-touch-none flex gap-1 overflow-x-auto border-b border-ink/8", className)}
    >
      {TABS.map((tab) => {
        const href = tab.key ? `${base}/${tab.key}` : base;
        const active = pathname === href;
        return (
          <Link
            key={tab.key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              // px-3, not px-4: at the width of an ordinary laptop the eleven
              // then fit on one line, and nobody has to scroll at all.
              "shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              active ? "border-cyan-strong text-ink" : "border-transparent text-ink/45 hover:text-ink"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
