"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Chats and Tasks, as two tabs over one list.
//
// Both panels are drawn on the server and switching only shows one and hides
// the other, so a tab opens instantly and nothing moves. The Tasks tab carries
// how many are open, in red when any of them is late — red in both looks,
// because late is a fact about the work rather than a matter of palette.

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
  variant = "phone",
}: {
  chats: ReactNode;
  tasks: ReactNode;
  openTasks: number;
  lateTasks: number;
  initialTab?: Tab;
  className?: string;
  tabsClassName?: string;
  panelClassName?: string;
  /** "phone" is the portal's own screen; "studio" is the manager's warm desk. */
  variant?: "phone" | "studio";
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const base = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const studio = variant === "studio";

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "chats", label: "Chats" },
    { key: "tasks", label: "Tasks", count: openTasks },
  ];

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label="Chats and tasks"
        className={cn(
          "relative grid shrink-0 grid-cols-2 rounded-xl p-1",
          studio ? "bg-clay-soft/60" : "bg-ink/[0.05]",
          tabsClassName
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-lg shadow-sm transition-transform duration-200 ease-out",
            studio ? "bg-card" : "bg-white"
          )}
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
                "relative z-10 flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2",
                studio ? "focus-visible:ring-clay/40" : "focus-visible:ring-cyan-strong/40",
                selected
                  ? studio
                    ? "text-bark"
                    : "text-ink"
                  : studio
                    ? "text-bark/50 hover:text-bark/75"
                    : "text-ink/50 hover:text-ink/75"
              )}
            >
              {item.label}
              {item.count ? (
                <span
                  className={cn(
                    "min-w-5 rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                    lateTasks > 0
                      ? "bg-red-500 text-white"
                      : studio
                        ? "bg-bark/10 text-bark/60"
                        : "bg-ink/10 text-ink/60"
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
