import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { GROUP_AVATAR } from "@/lib/chat-conversations";

// The top of a conversation, the way WhatsApp draws it: back, a picture, the
// name, and a line underneath — who is in the group, or that a private chat is
// private.
//
// On the employee's phone this replaces the portal's own header rather than
// sitting under it (see .chat-screen in globals.css), so it is the one that
// makes room for the status bar there.

export function ChatHeader({
  name,
  subtitle,
  avatar = GROUP_AVATAR,
  backHref,
}: {
  name: string;
  subtitle: string;
  /** The group's mark by default; a person's initials for a private chat. */
  avatar?: string;
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

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={avatar} alt="" className="h-10 w-10 shrink-0 rounded-full border border-ink/10 object-cover" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold leading-tight text-ink">{name}</p>
        <p className="mt-0.5 truncate text-xs text-ink/50">{subtitle}</p>
      </div>
    </div>
  );
}
