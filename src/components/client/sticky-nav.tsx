"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NavItem {
  key: string;
  label: string;
}

export function StickyNav({ items, projectName }: { items: NavItem[]; projectName: string }) {
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
    <div className="fixed inset-x-0 top-0 z-40 hidden sm:block">
      <nav className="glass-strong mx-auto mt-4 flex max-w-fit items-center gap-1 rounded-full px-2 py-2">
        <span className="px-3 text-xs font-semibold uppercase tracking-wider text-ink/40">{projectName}</span>
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
              {item.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > window.innerHeight * 0.6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function go(key: string) {
    document.getElementById(key)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setOpen(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-40 sm:hidden">
      {open && (
        <div className="glass-strong mb-2 flex max-h-64 flex-col gap-1 overflow-y-auto rounded-2xl p-2">
          {items.map((item) => (
            <button
              key={item.key}
              onClick={() => go(item.key)}
              className="rounded-xl px-3 py-2.5 text-left text-sm font-medium text-ink/70 hover:bg-ink/5"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="glass-strong flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-medium text-ink shadow-lg"
      >
        {open ? <X size={16} /> : <Menu size={16} />}
        {open ? "Close Menu" : "Project Sections"}
      </button>
    </div>
  );
}
