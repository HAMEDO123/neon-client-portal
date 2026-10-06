import Link from "next/link";
import { MessageCircle, User, Users } from "lucide-react";
import { initialsOf } from "@/lib/avatar";
import { listTime } from "@/lib/chat-conversations";
import { rowPreview, type InboxRow } from "@/lib/whatsapp-watch";
import { cn } from "@/lib/utils";

// One client's WhatsApp conversation, as a row in the chat list.
//
// Drawn to sit among the team's own rows and read as one of them — the same
// height, the same four things in the same places — with one difference that
// has to survive a glance: the green mark on the picture. A client is not a
// colleague, and answering here answers as the studio's number, so which kind
// of row it is must never depend on recognising a name.
//
// One component for the three places the list is drawn (the portal's list, the
// manager's, and the column beside an open conversation), because three copies
// of a row are three chances for the mark to go missing from one of them.
//
// The count is the handset's own: nothing in the platform marks a WhatsApp
// chat read, so the badge clears when somebody reads it on the phone, or
// answers.

export function WhatsAppRow({
  row,
  href,
  now,
  timeZone,
  active = false,
  look = "phone",
}: {
  row: InboxRow;
  href: string;
  now: Date;
  timeZone: string;
  active?: boolean;
  /** "phone" is the portal's list, "studio" the manager's, "panel" the column beside a conversation. */
  look?: "phone" | "studio" | "panel";
}) {
  const warm = look !== "phone";
  const panel = look === "panel";
  const unread = row.unread !== 0;
  // A chat known only by its number has no initials worth drawing.
  const named = !/^[+\d]/.test(row.title);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 px-4 py-3 transition-colors focus-visible:outline-none",
        warm ? "hover:bg-clay-soft/40 focus-visible:bg-clay-soft/50" : "hover:bg-ink/[0.03]",
        active && (warm ? "bg-clay-soft/70" : "bg-ink/[0.05]")
      )}
    >
      <span className="relative shrink-0">
        <span
          aria-hidden
          className={cn(
            "flex items-center justify-center bg-emerald-600/12 font-semibold text-emerald-800",
            panel ? "h-11 w-11 text-sm" : "h-12 w-12",
            warm ? "rounded-2xl" : "rounded-full"
          )}
        >
          {row.isGroup ? <Users size={20} strokeWidth={1.75} /> : named ? initialsOf(row.title) : <User size={20} strokeWidth={1.75} />}
        </span>
        <span
          aria-hidden
          className={cn(
            "absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white ring-2",
            warm ? "ring-card" : "ring-white"
          )}
        >
          <MessageCircle size={11} strokeWidth={2.5} />
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            dir="auto"
            className={cn("min-w-0 flex-1 truncate font-semibold", panel && "text-[15px]", warm ? "text-bark" : "text-ink")}
          >
            <span className="sr-only">WhatsApp: </span>
            {row.title}
          </span>
          <span
            className={cn(
              "shrink-0",
              panel ? "text-[11px]" : "text-xs",
              unread ? "font-semibold text-emerald-700" : warm ? "text-bark/35" : "text-ink/40"
            )}
          >
            {listTime(new Date(row.at), now, timeZone)}
          </span>
        </span>

        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span
            dir="auto"
            className={cn(
              "min-w-0 flex-1 truncate",
              panel ? "text-[13px]" : "text-sm",
              unread ? (warm ? "text-bark/70" : "text-ink/70") : warm ? "text-bark/45" : "text-ink/45"
            )}
          >
            {rowPreview(row)}
          </span>
          {unread && (
            <span
              className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[11px] font-semibold text-white"
              aria-label={row.unread > 0 ? `${row.unread} unread on WhatsApp` : "Marked unread on WhatsApp"}
            >
              {/* Marked unread on the handset has no number to show. */}
              {row.unread > 99 ? "99+" : row.unread > 0 ? row.unread : ""}
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}
