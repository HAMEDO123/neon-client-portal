import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { GROUP_AVATAR } from "@/lib/chat-conversations";
import { ReadoutTaps } from "@/components/viewport-readout";
import { cn } from "@/lib/utils";

// The top of a conversation, the way WhatsApp draws it: back, a picture, the
// name, and a line underneath — who is in the group, or that a private chat is
// private.
//
// On the employee's phone this replaces the portal's own header rather than
// sitting under it (see .chat-screen in globals.css), so it is the one that
// makes room for the status bar there. On the studio's desktop the same header
// sits at the top of the middle column, in the warm palette, and the way back
// is the list beside it rather than an arrow.

export function ChatHeader({
  name,
  subtitle,
  // Bound here on purpose, and it must stay bound: `status` is a global in
  // lib.dom.d.ts, so leaving it out of this list does not fail to compile —
  // the reads below quietly find window.status instead, which is the empty
  // string in a browser and nothing at all on the server.
  status,
  avatar = GROUP_AVATAR,
  backHref,
  actions,
  variant = "phone",
}: {
  name: string;
  subtitle: string;
  /** The group's mark by default; a person's initials for a private chat. */
  avatar?: string;
  backHref?: string;
  /** Buttons at the end of the header: the calls, and the search. */
  actions?: ReactNode;
  /**
   * Where the other person is, when that is known: "Online", "Last seen 2 min
   * ago". Replaces the subtitle while it is known, and is simply absent
   * otherwise — the platform not having seen somebody is not the same as their
   * being away, so nothing is said rather than "Offline".
   */
  status?: string | null;
  /** "phone" is the portal's own screen; "studio" is the manager's three-column desk. */
  variant?: "phone" | "studio";
}) {
  const studio = variant === "studio";

  return (
    <div
      className={cn(
        "chat-header flex shrink-0 items-center gap-2.5 border-b backdrop-blur-lg",
        studio ? "border-warm-line bg-card px-3 py-2.5 lg:px-4" : "border-ink/10 bg-[#f6f6f6]/95 px-2 py-2"
      )}
    >
      {backHref && (
        <Link
          href={backHref}
          aria-label="Back"
          className={cn(
            "-mr-1 flex h-10 w-8 shrink-0 items-center justify-center",
            // On a wide screen the list is already beside it; the arrow is for the phone.
            studio ? "text-bark/50 lg:hidden" : "text-[#007aff]"
          )}
        >
          <ChevronLeft size={28} strokeWidth={2.25} />
        </Link>
      )}

      {/* Five quick taps on the picture show this phone's screen measurements. */}
      <ReadoutTaps>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatar}
          alt=""
          className={cn(
            "h-10 w-10 shrink-0 border object-cover",
            studio ? "rounded-2xl border-warm-line" : "rounded-full border-ink/10"
          )}
        />
      </ReadoutTaps>

      <div className="min-w-0 flex-1">
        <p className={cn("truncate font-semibold leading-tight", studio ? "text-[17px] text-bark" : "text-base text-ink")}>
          {name}
        </p>
        <p className={cn("mt-0.5 flex items-center gap-1.5 truncate text-xs", studio ? "text-bark/45" : "text-ink/50")}>
          {status === "Online" && (
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
          )}
          <span className="truncate">{status ?? subtitle}</span>
        </p>
      </div>

      {actions}
    </div>
  );
}
