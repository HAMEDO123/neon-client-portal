"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { isConversationPath } from "@/lib/chat-conversations";
import { UpdateRequired } from "@/components/update-required";

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
export function LiveSync({ version }: { version?: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const stale = useRef(false);
  const [outdated, setOutdated] = useState(false);

  useEffect(() => {
    const source = new EventSource("/api/live");

    // A deploy replaces the server, so every open heartbeat drops and the
    // browser reconnects — to the new build. Its first word says which build
    // it is, and a page rendered by the one before it cannot be used safely:
    // its server actions belong to a server that no longer exists.
    const onReady = (event: MessageEvent) => {
      if (!version) return;
      try {
        const serving = (JSON.parse(event.data) as { version?: string }).version;
        if (serving && serving !== version) {
          setOutdated(true);
          // Nothing more to listen for; the page is about to be replaced.
          source.close();
        }
      } catch {
        // A payload we cannot read is not a reason to interrupt anybody.
      }
    };
    source.addEventListener("ready", onReady as EventListener);

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
  }, [router, version]);

  return outdated ? <UpdateRequired /> : null;
}
