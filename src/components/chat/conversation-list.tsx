import Link from "next/link";
import type { ConversationSummary } from "@/lib/chat";
import { listTime, previewLine } from "@/lib/chat-conversations";
import { cn } from "@/lib/utils";

// The list of conversations, the way WhatsApp's chat list reads: a picture,
// the name, the last message under it, when it was, and a count of what has
// not been read yet.
//
// Two looks, one list — as ChatRoom and ChatHeader do it. "phone" is the
// employees' portal and is the default, so nothing there moves; "studio" is the
// manager's warm desk. The rows say the same things in both.

export function ConversationList({
  items,
  basePath,
  timeZone,
  activeSlug,
  now = new Date(),
  variant = "phone",
}: {
  items: ConversationSummary[];
  /** Where the conversations live: "/employee/chat" or "/admin/chat". */
  basePath: string;
  timeZone: string;
  /** The one open beside the list, on a wide screen. */
  activeSlug?: string;
  now?: Date;
  /** "phone" is the portal's own list; "studio" is the manager's warm one. */
  variant?: "phone" | "studio";
}) {
  const studio = variant === "studio";

  return (
    <ul className={cn("flex flex-col divide-y", studio ? "divide-warm-line" : "divide-ink/6")}>
      {items.map((item) => {
        const preview = previewLine(item.last, item.isGroup);
        const active = item.slug === activeSlug;

        return (
          <li key={item.slug}>
            <Link
              href={`${basePath}/${item.slug}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 px-4 py-3 transition-colors",
                studio ? "hover:bg-clay-soft/40" : "hover:bg-ink/[0.03]",
                active && (studio ? "bg-clay-soft/70" : "bg-ink/[0.05]")
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.avatar}
                alt=""
                className={cn(
                  "h-12 w-12 shrink-0 border object-cover",
                  studio ? "rounded-2xl border-warm-line" : "rounded-full border-ink/10"
                )}
              />

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={cn("truncate font-semibold", studio ? "text-bark" : "text-ink")}>{item.title}</p>
                  {item.last && (
                    <span
                      className={cn(
                        "shrink-0 text-xs",
                        item.unread > 0
                          ? studio
                            ? "font-semibold text-clay-deep"
                            : "font-medium text-emerald-600"
                          : studio
                            ? "text-bark/35"
                            : "text-ink/40"
                      )}
                    >
                      {listTime(item.last.createdAt, now, timeZone)}
                    </span>
                  )}
                </div>

                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <p
                    className={cn(
                      "truncate text-sm",
                      item.unread > 0
                        ? studio
                          ? "text-bark/70"
                          : "text-ink/70"
                        : studio
                          ? "text-bark/45"
                          : "text-ink/45"
                    )}
                    dir="auto"
                  >
                    {preview ?? (item.isGroup ? "No messages yet" : "Start a private conversation")}
                  </p>
                  {item.unread > 0 && (
                    <span
                      className={cn(
                        "flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-white",
                        studio ? "bg-clay" : "bg-emerald-600"
                      )}
                      aria-label={`${item.unread} unread`}
                    >
                      {item.unread > 99 ? "99+" : item.unread}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
