import Link from "next/link";
import { MessageCircle, Pin } from "lucide-react";
import type { ConversationSummary } from "@/lib/chat";
import type { InboxSummary } from "@/lib/whatsapp-watch";
import { listTime, previewLine } from "@/lib/chat-conversations";
import { cn } from "@/lib/utils";

// The list of conversations, the way WhatsApp's chat list reads: a picture,
// the name, the last message under it, when it was, and a count of what has
// not been read yet.
//
// Two looks, one list — as ChatRoom and ChatHeader do it. "phone" is the
// employees' portal and is the default, so nothing there moves; "studio" is the
// manager's warm desk. The rows say the same things in both.
//
// **The studio's WhatsApp is the first row, for everybody who may open it.**
// The studio asked for the company number to sit at the top of the chats,
// pinned, for the whole team — a client writing in belongs beside the
// conversations the team already keeps an eye on, not behind a tab of its own.
// It is one row that opens the inbox, not a row per client: the inbox has its
// own list, its own search and its own replies, and the people in it are not
// in this platform. What the row says comes from the last look at the number
// (lib/whatsapp-watch.ts), stored, so drawing this list never waits on it.

export function ConversationList({
  items,
  basePath,
  timeZone,
  activeSlug,
  now = new Date(),
  variant = "phone",
  whatsapp = null,
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
  /** The company number's row, for a viewer who may open it. Null draws nothing. */
  whatsapp?: { href: string; summary: InboxSummary } | null;
}) {
  const studio = variant === "studio";

  return (
    <ul className={cn("flex flex-col divide-y", studio ? "divide-warm-line" : "divide-ink/6")}>
      {whatsapp && (
        <li>
          <Link
            href={whatsapp.href}
            className={cn(
              "flex items-center gap-3 px-4 py-3 transition-colors",
              studio ? "bg-clay-soft/25 hover:bg-clay-soft/50" : "bg-emerald-500/[0.04] hover:bg-emerald-500/[0.08]"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center bg-emerald-600 text-white",
                studio ? "rounded-2xl" : "rounded-full"
              )}
            >
              <MessageCircle size={24} strokeWidth={1.9} />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className={cn("flex min-w-0 items-center gap-1.5 font-semibold", studio ? "text-bark" : "text-ink")}>
                  <span className="truncate">WhatsApp</span>
                  <Pin size={12} strokeWidth={2.25} className={cn("shrink-0", studio ? "text-bark/35" : "text-ink/35")} aria-label="Pinned" />
                </p>
                {whatsapp.summary.latest && (
                  <span
                    className={cn(
                      "shrink-0 text-xs",
                      whatsapp.summary.unreadChats > 0
                        ? "font-semibold text-clay-deep"
                        : studio
                          ? "text-bark/35"
                          : "text-ink/40"
                    )}
                  >
                    {listTime(new Date(whatsapp.summary.latest.at), now, timeZone)}
                  </span>
                )}
              </div>

              <div className="mt-0.5 flex items-center justify-between gap-2">
                <p
                  className={cn(
                    "truncate text-sm",
                    whatsapp.summary.unreadChats > 0
                      ? studio
                        ? "text-bark/70"
                        : "text-ink/70"
                      : studio
                        ? "text-bark/45"
                        : "text-ink/45"
                  )}
                  dir="auto"
                >
                  {whatsapp.summary.latest
                    ? `${whatsapp.summary.latest.fromMe ? "You → " : ""}${whatsapp.summary.latest.title}: ${whatsapp.summary.latest.preview}`
                    : "The company's number — messages from clients"}
                </p>
                {whatsapp.summary.unreadChats > 0 && (
                  <span
                    className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[11px] font-semibold text-white"
                    aria-label={`${whatsapp.summary.unreadChats} chats with unread messages`}
                  >
                    {whatsapp.summary.unreadChats > 99 ? "99+" : whatsapp.summary.unreadChats}
                  </span>
                )}
              </div>
            </div>
          </Link>
        </li>
      )}

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
                        // Clay in both looks now that the portal is warm too.
                        // Unread is not information this colour carries — the
                        // count beside it says that — so it follows the palette
                        // rather than keeping WhatsApp's green on paper.
                        item.unread > 0
                          ? "font-semibold text-clay-deep"
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
                      className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-clay px-1.5 text-[11px] font-semibold text-white"
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
