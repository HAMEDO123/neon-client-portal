"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { AdminNav } from "@/components/admin/admin-nav";
import { LiveSync } from "@/components/live-sync";
import { SoundCues } from "@/components/sound-cues";
import { isConversationPath } from "@/lib/chat-conversations";
import type { AdminBadges } from "@/lib/admin-badges";
import { cn } from "@/lib/utils";

// The sidebar layout only works at desktop widths — on a phone (the iOS
// sideload wrapper, or just Safari) a fixed 256px sidebar eats most of the
// screen and crushes the content next to it. Below lg, swap it for a top bar
// + slide-in drawer instead.
export function AdminShell({
  children,
  badges,
}: {
  children: ReactNode;
  badges?: AdminBadges;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Forms and lists read better in a narrow column, but the task board is a
  // matrix — it gets the whole window so it fits without sideways scrolling.
  const wide = pathname.startsWith("/admin/tasks");

  // An open conversation fills the window and scrolls inside itself, the way
  // a messaging app does; every other page scrolls as a page.
  const fill = isConversationPath(pathname);

  // On a phone the counts sit inside the closed menu, so the menu button
  // carries a dot when anything is waiting.
  const waiting =
    (badges?.reviews ?? 0) + (badges?.alerts ?? 0) + (badges?.chat ?? 0) + (badges?.requests ?? 0) > 0;

  // The sidebar is part of the window, not part of the page: it stays put
  // while the content scrolls, the way a desktop app behaves. The window is
  // 100dvh, not 100vh: on an iPhone 100vh is the height with Safari's bars
  // hidden, which put the bottom of every page under the toolbar.
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* Board, badges and review queue stay current on their own. */}
      <LiveSync />
      {/* One sound for a message, another for everything else. */}
      <SoundCues side="ADMIN" />
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-ink/8 bg-white/40 lg:block">
        <AdminNav badges={badges} />
      </aside>

      {/* min-w-0 lets this column be narrower than its widest child. Without
          it one wide table stretched the column past the screen, and the right
          side of the page — the menu button with it — was cut off. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-ink/8 bg-white/60 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:hidden">
          <span className="text-base font-bold">
            <span className="text-gradient-neon">NEON</span>
            <span className="ml-1.5 text-sm font-medium text-ink/60">Admin</span>
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={waiting ? "Open menu, something is waiting" : "Open menu"}
            className="relative rounded-lg p-2 text-ink/60 hover:bg-ink/5"
          >
            <Menu size={20} />
            {waiting && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-pink ring-2 ring-white" aria-hidden />
            )}
          </button>
        </div>

        <main
          className={cn(
            "flex-1",
            fill
              ? "min-h-0 overflow-hidden"
              : "overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 lg:px-8 lg:pb-10 lg:pt-10"
          )}
        >
          <div className={cn("mx-auto", fill ? "h-full" : wide ? "max-w-none" : "max-w-5xl")}>{children}</div>
        </main>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/40"
          />
          {/* The panel scrolls, so Sign out at the foot of the list is
              reachable on a short screen. */}
          <div
            className="absolute inset-y-0 left-0 w-72 max-w-[80vw] overflow-y-auto bg-bg pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-xl"
            onClick={() => setOpen(false)}
          >
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] rounded-lg p-2 text-ink/60 hover:bg-ink/5"
            >
              <X size={20} />
            </button>
            <AdminNav badges={badges} />
          </div>
        </div>
      )}
    </div>
  );
}
