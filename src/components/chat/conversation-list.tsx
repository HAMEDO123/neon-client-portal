import Link from "next/link";
import type { ConversationSummary } from "@/lib/chat";
import { listTime, previewLine } from "@/lib/chat-conversations";
import { cn } from "@/lib/utils";

// The list of conversations, the way WhatsApp's chat list reads: a picture,
// the name, the last message under it, when it was, and a count of what has
// not been read yet.

export function ConversationList({
  items,
  basePath,
  timeZone,
  activeSlug,
  now = new Date(),
}: {
  items: ConversationSummary[];
  /** Where the conversations live: "/employee/chat" or "/admin/chat". */
  basePath: string;
  timeZone: string;
  /** The one open beside the list, on a wide screen. */
  activeSlug?: string;
  now?: Date;
}) {
  return (
    <ul className="flex flex-col divide-y divide-ink/6">
      {items.map((item) => {
        const preview = previewLine(item.last, item.isGroup);
        const active = item.slug === activeSlug;

        return (
          <li key={item.slug}>
            <Link
              href={`${basePath}/${item.slug}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-ink/[0.03]",
                active && "bg-ink/[0.05]"
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.avatar} alt="" className="h-12 w-12 shrink-0 rounded-full border border-ink/10 object-cover" />

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate font-semibold text-ink">{item.title}</p>
                  {item.last && (
                    <span
                      className={cn(
                        "shrink-0 text-xs",
                        item.unread > 0 ? "font-medium text-emerald-600" : "text-ink/40"
                      )}
                    >
                      {listTime(item.last.createdAt, now, timeZone)}
                    </span>
                  )}
                </div>

                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <p className={cn("truncate text-sm", item.unread > 0 ? "text-ink/70" : "text-ink/45")} dir="auto">
                    {preview ?? (item.isGroup ? "No messages yet" : "Start a private conversation")}
                  </p>
                  {item.unread > 0 && (
                    <span
                      className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[11px] font-semibold text-white"
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
