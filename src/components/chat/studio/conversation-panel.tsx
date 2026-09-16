"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ListChecks, MessageSquarePlus, Search, Users, X } from "lucide-react";
import type { ConversationSummary } from "@/lib/chat";
import { listTime, previewLine } from "@/lib/chat-conversations";
import { useMinuteNow } from "@/lib/use-minute-now";
import { cn } from "@/lib/utils";

// Every conversation the manager has, as a column beside the open one: a
// search box, a few filters, and the rows themselves — the group first, then
// each person, the most recent at the top.
//
// The filters read what is already known about each conversation (unread
// counts, whether it is the group), so nothing here needs a query of its own.

type Filter = "all" | "unread" | "groups";

export function ConversationPanel({
  items,
  basePath,
  timeZone,
  activeSlug,
  initialNow,
  tasksHref,
}: {
  items: ConversationSummary[];
  /** Where the conversations live: "/admin/chat". */
  basePath: string;
  timeZone: string;
  activeSlug?: string;
  initialNow: number;
  /** Where the tasks handed out in chats are listed. */
  tasksHref?: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const now = useMinuteNow() ?? initialNow;

  const unreadCount = items.filter((item) => item.unread > 0).length;
  const groupCount = items.filter((item) => item.isGroup).length;

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === "unread" && item.unread === 0) return false;
      if (filter === "groups" && !item.isGroup) return false;
      if (!needle) return true;
      const preview = previewLine(item.last, item.isGroup) ?? "";
      return `${item.title} ${item.subtitle ?? ""} ${preview}`.toLowerCase().includes(needle);
    });
  }, [items, filter, search]);

  // Somebody nobody has written to yet is where a new conversation starts.
  const unstarted = items.filter((item) => !item.last && !item.isGroup);

  const filters: { key: Filter; label: string; count?: number }[] = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread", count: unreadCount },
    { key: "groups", label: "Groups", count: groupCount },
  ];

  return (
    // w-full min-w-0 is what keeps this to the column it sits in: as a flex
    // item it would otherwise size to its widest preview line and push the
    // times, the unread counts and the button's own label out of sight.
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <div className="px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold text-bark">Team Chat</h2>
            <p className="mt-0.5 text-xs text-bark/45">Collaborate. Design. Deliver.</p>
          </div>
          {tasksHref && (
            <Link
              href={tasksHref}
              aria-label="Tasks handed out in chats"
              title="Tasks handed out in chats"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-bark/45 transition-colors hover:bg-clay-soft/70 hover:text-bark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay/40"
            >
              <ListChecks size={17} />
            </Link>
          )}
        </div>

        <div className="relative mt-3">
          <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bark/35" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            type="search"
            placeholder="Search conversations…"
            aria-label="Search conversations"
            className="h-10 w-full rounded-full border border-warm-line bg-paper-soft pl-9 pr-9 text-sm text-bark outline-none transition-colors placeholder:text-bark/35 focus:border-clay focus-visible:ring-2 focus-visible:ring-clay/25"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear the search"
              className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-bark/40 hover:bg-bark/5 hover:text-bark"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="mt-3 flex gap-1.5" role="group" aria-label="Filter conversations">
          {filters.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={filter === item.key}
              onClick={() => setFilter(item.key)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay/40",
                filter === item.key ? "bg-bark text-paper" : "bg-clay-soft/60 text-bark/60 hover:bg-clay-soft"
              )}
            >
              {item.label}
              {item.count ? (
                <span className={cn("tabular-nums", filter === item.key ? "text-paper/70" : "text-bark/40")}>
                  {item.count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-warm-line">
        {shown.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-bark/45">
            {search ? `Nothing matches “${search.trim()}”.` : "Nothing here yet."}
          </p>
        ) : (
          <ul className="flex flex-col">
            {shown.map((item) => {
              const preview = previewLine(item.last, item.isGroup);
              const active = item.slug === activeSlug;
              return (
                <li key={item.slug}>
                  <Link
                    href={`${basePath}/${item.slug}`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 transition-colors focus-visible:outline-none",
                      active ? "bg-clay-soft/70" : "hover:bg-clay-soft/40 focus-visible:bg-clay-soft/50"
                    )}
                  >
                    <span className="relative shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.avatar}
                        alt=""
                        className="h-11 w-11 rounded-2xl border border-warm-line object-cover"
                      />
                      {item.isGroup && (
                        <span
                          aria-hidden
                          className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-card text-bark/50 shadow-sm"
                        >
                          <Users size={11} />
                        </span>
                      )}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-bark">{item.title}</span>
                        {item.last && (
                          <span
                            className={cn(
                              "shrink-0 text-[11px]",
                              item.unread > 0 ? "font-semibold text-clay-deep" : "text-bark/35"
                            )}
                          >
                            {listTime(item.last.createdAt, new Date(now), timeZone)}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span
                          dir="auto"
                          className={cn(
                            "min-w-0 flex-1 truncate text-[13px]",
                            item.unread > 0 ? "text-bark/70" : "text-bark/45"
                          )}
                        >
                          {preview ?? (item.isGroup ? "No messages yet" : (item.subtitle ?? "Start a conversation"))}
                        </span>
                        {item.unread > 0 && (
                          <span
                            className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-clay px-1.5 text-[11px] font-semibold text-white"
                            aria-label={`${item.unread} unread`}
                          >
                            {item.unread > 99 ? "99+" : item.unread}
                          </span>
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {unstarted.length > 0 && (
        <details className="group border-t border-warm-line p-3">
          {/* The row inside rather than on the summary itself: browsers differ
              on what display:flex does to a summary's marker. */}
          <summary className="cursor-pointer list-none rounded-full [&::-webkit-details-marker]:hidden">
            <span className="flex h-11 items-center justify-center gap-2 rounded-full bg-clay text-sm font-semibold text-white transition-colors hover:bg-clay-deep group-open:bg-clay-deep">
              <MessageSquarePlus size={16} aria-hidden />
              New chat
            </span>
          </summary>
          <ul className="mt-2 max-h-56 overflow-y-auto">
            {unstarted.map((item) => (
              <li key={item.slug}>
                <Link
                  href={`${basePath}/${item.slug}`}
                  className="flex items-center gap-2.5 rounded-xl px-2 py-2 text-sm text-bark/75 transition-colors hover:bg-clay-soft/60"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.avatar} alt="" className="h-8 w-8 rounded-full border border-warm-line object-cover" />
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {item.subtitle && <span className="shrink-0 truncate text-xs text-bark/40">{item.subtitle}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
