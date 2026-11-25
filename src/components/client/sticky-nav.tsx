"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/client-i18n";

export interface NavItem {
  key: string;
  label: string;
}

// The project's sections as one bar at the top of the screen, on a phone as on
// a desk. A phone had a "Project Sections" button floating at the foot of the
// screen instead, over whatever the client was reading (2026-11-25: "it covers
// whats behind it, make it like the desktop view on the top of the page"). On a
// phone the bar is the row of sections alone, scrolled sideways, and stops short
// of the language button in the corner.
export function StickyNav({ items, projectName }: { items: NavItem[]; projectName: string }) {
  const { t } = useI18n();
  const [active, setActive] = useState(items[0]?.key ?? "");
  const [visible, setVisible] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > window.innerHeight * 0.6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.key))
      .filter((el): el is HTMLElement => !!el);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: [0, 1] }
    );

    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  useEffect(() => {
    const activeButton = railRef.current?.querySelector<HTMLElement>(`[data-key="${active}"]`);
    activeButton?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [active]);

  function go(key: string) {
    document.getElementById(key)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-40">
      <nav className="glass-strong ms-3 me-32 mt-3 flex items-center gap-1 rounded-full px-1.5 py-1.5 sm:mx-auto sm:mt-4 sm:max-w-fit sm:px-2 sm:py-2">
        <span className="hidden px-3 text-xs font-semibold uppercase tracking-wider text-ink/40 sm:inline">{projectName}</span>
        <div ref={railRef} className="scrollbar-none flex items-center gap-1 overflow-x-auto">
          {items.map((item) => (
            <button
              key={item.key}
              data-key={item.key}
              onClick={() => go(item.key)}
              className={cn(
                "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                active === item.key ? "bg-ink text-bg" : "text-ink/55 hover:bg-ink/5 hover:text-ink"
              )}
            >
              {t(item.label)}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
