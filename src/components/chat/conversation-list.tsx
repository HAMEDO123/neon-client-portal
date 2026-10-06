import Link from "next/link";
import type { ConversationSummary } from "@/lib/chat";
import { mergeChatList, type InboxRow } from "@/lib/whatsapp-watch";
import { listTime, previewLine } from "@/lib/chat-conversations";
import { WhatsAppRow } from "@/components/chat/whatsapp-row";
import { cn } from "@/lib/utils";

// The list of conversations, the way WhatsApp's chat list reads: a picture,
// the name, the last message under it, when it was, and a count of what has
// not been read yet.
//
// Two looks, one list — as ChatRoom and ChatHeader do it. "phone" is the
// employees' portal and is the default, so nothing there moves; "studio" is the
// manager's warm desk. The rows say the same things in both.
//
// **The company number's clients are in this list, a row each.** The studio
// asked for the company WhatsApp to be in the same chat the team already uses
// — not a tab beside it, and not one row that opens a second inbox, which is
// what this drew first and what the studio sent back. So a client who writes
// sits between the colleagues who wrote before and after them, in order of the
// last message (`mergeChatList`), and opens as a conversation in this section.
// The rows come from the last look at the number (lib/whatsapp-watch.ts),
// stored, so drawing this list never waits on the worker; they are at most a
// minute behind.

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
  /**
   * The company number's conversations, for a viewer who may open them: where
   * one opens (`basePath`, the id appended), the rows, and where the whole
   * inbox is — the list carries the most recent, not every chat there has
   * ever been. Null draws nothing.
   */
  whatsapp?: { basePath: string; rows: InboxRow[]; allHref: string } | null;
}) {
  const studio = variant === "studio";
  const entries = mergeChatList(items, whatsapp?.rows ?? []);

  return (
    <ul className={cn("flex flex-col divide-y", studio ? "divide-warm-line" : "divide-ink/6")}>
      {entries.map((entry) => {
        if (entry.kind === "whatsapp") {
          return (
            <li key={`wa:${entry.row.id}`}>
              <WhatsAppRow
                row={entry.row}
                href={`${whatsapp!.basePath}/${encodeURIComponent(entry.row.id)}`}
                now={now}
                timeZone={timeZone}
                look={studio ? "studio" : "phone"}
              />
            </li>
          );
        }

        const item = entry.item;
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

      {whatsapp && whatsapp.rows.length > 0 && (
        <li>
          <Link
            href={whatsapp.allHref}
            className={cn(
              "block px-4 py-3 text-center text-xs font-medium transition-colors",
              studio ? "text-bark/50 hover:bg-clay-soft/40" : "text-ink/45 hover:bg-ink/[0.03]"
            )}
          >
            Older WhatsApp chats, and search
          </Link>
        </li>
      )}
    </ul>
  );
}
