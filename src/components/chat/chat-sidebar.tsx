"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Chats and Tasks, as two tabs over one list.
//
// Both panels are drawn on the server and switching only shows one and hides
// the other, so a tab opens instantly and nothing moves. The Tasks tab carries
// how many are open, in red when any of them is late.

type Tab = "chats" | "tasks";

export function ChatSidebar({
  chats,
  tasks,
  openTasks,
  lateTasks,
  initialTab = "chats",
  className,
  tabsClassName,
  panelClassName,
}: {
  chats: ReactNode;
  tasks: ReactNode;
  openTasks: number;
  lateTasks: number;
  initialTab?: Tab;
  className?: string;
  tabsClassName?: string;
  panelClassName?: string;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const base = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "chats", label: "Chats" },
    { key: "tasks", label: "Tasks", count: openTasks },
  ];

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label="Chats and tasks"
        className={cn("relative grid shrink-0 grid-cols-2 rounded-xl bg-ink/[0.05] p-1", tabsClassName)}
      >
        <span
          aria-hidden
          className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-white shadow-sm transition-transform duration-200 ease-out"
          style={{ transform: tab === "tasks" ? "translateX(100%)" : "translateX(0)" }}
        />
        {tabs.map((item, index) => {
          const selected = tab === item.key;
          return (
            <button
              key={item.key}
              ref={(node) => {
                buttons.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${base}-${item.key}-tab`}
              aria-selected={selected}
              aria-controls={`${base}-${item.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(item.key)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                event.preventDefault();
                const next = (index + 1) % tabs.length;
                setTab(tabs[next].key);
                buttons.current[next]?.focus();
              }}
              className={cn(
                "relative z-10 flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-strong/40",
                selected ? "text-ink" : "text-ink/50 hover:text-ink/75"
              )}
            >
              {item.label}
              {item.count ? (
                <span
                  className={cn(
                    "min-w-5 rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                    lateTasks > 0 ? "bg-red-500 text-white" : "bg-ink/10 text-ink/60"
                  )}
                >
                  {item.count}
                  {lateTasks > 0 && <span className="sr-only">, {lateTasks} overdue</span>}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${base}-chats`}
        aria-labelledby={`${base}-chats-tab`}
        hidden={tab !== "chats"}
        className={panelClassName}
      >
        {chats}
      </div>
      <div
        role="tabpanel"
        id={`${base}-tasks`}
        aria-labelledby={`${base}-tasks-tab`}
        hidden={tab !== "tasks"}
        className={panelClassName}
      >
        {tasks}
      </div>
    </div>
  );
}
