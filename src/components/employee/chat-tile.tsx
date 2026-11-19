import Link from "next/link";
import { ArrowRight, MessagesSquare } from "lucide-react";
import type { ConversationSummary } from "@/lib/chat";
import { listTime, previewLine } from "@/lib/chat-conversations";
import { cn } from "@/lib/utils";

// The home screen's chat tile (design 2, 2026-11-19): the conversations that
// moved most recently, unread first, so a message is seen without opening the
// chat. Read-only; the chat itself is one tap away.

export function ChatTile({
  conversations,
  timeZone,
  now,
  limit = 4,
}: {
  conversations: ConversationSummary[];
  timeZone: string;
  now: Date;
  limit?: number;
}) {
  const rows = conversations
    .filter((row) => row.last)
    .sort(
      (a, b) =>
        Number(b.unread > 0) - Number(a.unread > 0) ||
        b.last!.createdAt.getTime() - a.last!.createdAt.getTime(),
    )
    .slice(0, limit);
  const unread = conversations.reduce((sum, row) => sum + row.unread, 0);

  return (
    <section aria-label="Chat" className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <h2 className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/55">
          <MessagesSquare size={14} strokeWidth={2} />
          Chat{unread > 0 ? ` · ${unread} unread` : ""}
        </h2>
        <Link
          href="/employee/chat"
          className="inline-flex items-center gap-1 text-xs font-semibold text-clay-deep hover:underline"
        >
          Open <ArrowRight size={13} strokeWidth={2.25} />
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink/55">No messages yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {rows.map((row) => (
            <li key={row.slug}>
              <Link
                href={`/employee/chat/${row.slug}`}
                className="flex items-center gap-3 rounded-2xl px-2.5 py-2 transition-colors hover:bg-ink/[0.04]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a face from our own /api/avatar or upload */}
                <img
                  src={row.avatar}
                  alt=""
                  width={36}
                  height={36}
                  className="h-9 w-9 shrink-0 rounded-xl object-cover"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span
                      dir="auto"
                      className={cn(
                        "truncate text-sm text-ink",
                        row.unread > 0 ? "font-semibold" : "font-medium",
                      )}
                    >
                      {row.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-ink/50">
                      {listTime(row.last!.createdAt, now, timeZone)}
                    </span>
                  </span>
                  <span
                    dir="auto"
                    className="block truncate text-xs text-ink/60"
                  >
                    {previewLine(row.last, row.isGroup)}
                  </span>
                </span>
                {row.unread > 0 && (
                  <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-clay px-1.5 text-[11px] font-semibold text-white">
                    {row.unread > 99 ? "99+" : row.unread}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
