"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { isConversationPath } from "@/lib/chat-conversations";

/** Fired on window whenever the heartbeat says something changed. The sounds listen for it. */
export const LIVE_CHANGED = "neon:live-changed";

// Keeps whatever page it is mounted on current.
//
// It renders nothing. It holds the platform heartbeat open and, when the
// server says something changed, asks Next to re-render this route on the
// server and swap in the new markup — client state (open menus, half-typed
// text, scroll position) survives, which a reload would not.
//
// Two things keep it from thrashing: refreshes are coalesced through a
// transition, and a hidden tab does not refresh at all — it catches up the
// moment it comes back into view.
export function LiveSync() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const stale = useRef(false);

  useEffect(() => {
    const source = new EventSource("/api/live");

    const refresh = () => {
      // An open conversation has its own live connection that delivers each
      // message as it arrives. Redrawing the whole page on top of that, for
      // every change from anyone, was a second full render nobody needed. The
      // list of conversations is a page like any other and keeps up.
      if (isConversationPath(window.location.pathname)) return;

      if (document.visibilityState === "hidden") {
        stale.current = true;
        return;
      }
      stale.current = false;
      startTransition(() => router.refresh());
    };

    const onChanged = () => {
      // Whatever else is listening hears about every change, on every screen.
      window.dispatchEvent(new Event(LIVE_CHANGED));
      refresh();
    };

    source.addEventListener("changed", onChanged);

    const onVisible = () => {
      if (document.visibilityState === "visible" && stale.current) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      source.close();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}
