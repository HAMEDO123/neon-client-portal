import Link from "next/link";
import { ChevronLeft } from "lucide-react";

// The top of a group chat, the way WhatsApp draws it: back, the group's photo,
// its name, and who is in it underneath.
//
// On the employee's phone this replaces the portal's own header rather than
// sitting under it (see .chat-screen in globals.css), so it is the one that
// makes room for the status bar there.

export function ChatHeader({
  name,
  members,
  backHref,
}: {
  name: string;
  members: string;
  backHref?: string;
}) {
  return (
    <div className="chat-header flex shrink-0 items-center gap-2.5 border-b border-ink/10 bg-[#f6f6f6]/95 px-2 py-2 backdrop-blur-lg">
      {backHref && (
        <Link
          href={backHref}
          aria-label="Back"
          className="-mr-1 flex h-10 w-8 shrink-0 items-center justify-center text-[#007aff]"
        >
          <ChevronLeft size={28} strokeWidth={2.25} />
        </Link>
      )}

      {/* The group's photo: the studio's own mark, in a circle like any group's. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/admin-icon-192.png"
        alt=""
        className="h-10 w-10 shrink-0 rounded-full border border-ink/10 object-cover"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold leading-tight text-ink">{name}</p>
        <p className="mt-0.5 truncate text-xs text-ink/50">{members}</p>
      </div>
    </div>
  );
}
