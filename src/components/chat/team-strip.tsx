import Link from "next/link";
import type { ConversationSummary } from "@/lib/chat";
import { cn } from "@/lib/utils";

// The row of faces across the top of the portal's chat (design 2, 2026-11-19):
// everybody you talk to, a tap from their conversation. A ring in the accent
// colour says there is something unread, a green dot that they are on the
// platform now. Unread first, then whoever wrote last.

export function TeamStrip({
  conversations,
  basePath,
  activeSlug = null,
  className,
}: {
  conversations: ConversationSummary[];
  basePath: string;
  activeSlug?: string | null;
  className?: string;
}) {
  const people = [...conversations].sort(
    (a, b) =>
      Number(b.unread > 0) - Number(a.unread > 0) ||
      (b.last?.createdAt.getTime() ?? 0) - (a.last?.createdAt.getTime() ?? 0),
  );
  if (people.length === 0) return null;

  const online = conversations.filter((row) => row.online).length;

  return (
    <nav
      aria-label="People"
      className={cn(
        "glass flex items-center gap-4 rounded-2xl px-4 py-3",
        className,
      )}
    >
      <div className="hidden w-20 shrink-0 sm:block">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/55">
          Team
        </p>
        {online > 0 && (
          <p className="mt-0.5 text-xs text-ink/60">{online} online</p>
        )}
      </div>
      <ul className="-my-1 flex min-w-0 flex-1 gap-1 overflow-x-auto py-1 [scrollbar-width:none]">
        {people.map((row) => {
          const unread = row.unread > 0;
          const active = row.slug === activeSlug;
          return (
            <li key={row.slug} className="shrink-0">
              <Link
                href={`${basePath}/${row.slug}`}
                aria-current={active ? "page" : undefined}
                aria-label={
                  unread ? `${row.title}, ${row.unread} unread` : row.title
                }
                className="flex w-[4.5rem] flex-col items-center gap-1.5 rounded-2xl py-1 transition-colors hover:bg-ink/[0.04]"
              >
                <span
                  className={cn(
                    "relative rounded-full p-[3px]",
                    unread ? "bg-clay" : active ? "bg-ink/25" : "bg-ink/10",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a face from our own /api/avatar or upload */}
                  <img
                    src={row.avatar}
                    alt=""
                    width={52}
                    height={52}
                    className="h-[3.25rem] w-[3.25rem] rounded-full border-[3px] border-card object-cover"
                  />
                  {row.online && (
                    <span className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full bg-emerald-500 ring-2 ring-card" />
                  )}
                </span>
                <span
                  dir="auto"
                  className={cn(
                    "max-w-full truncate px-1 text-xs",
                    unread ? "font-semibold text-ink" : "text-ink/70",
                  )}
                >
                  {firstWord(row.title)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** "Sally Mohammad" → "Sally"; a group's name is kept whole. */
function firstWord(title: string) {
  const first = title.trim().split(/\s+/)[0] ?? title;
  return first.length >= 3 ? first : title;
}
