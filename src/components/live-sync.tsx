"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

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
      // The chat has its own live connection that delivers each message as it
      // arrives. Redrawing the whole page on top of that, for every message
      // from anyone, was a second full render nobody needed.
      if (window.location.pathname.endsWith("/chat")) return;

      if (document.visibilityState === "hidden") {
        stale.current = true;
        return;
      }
      stale.current = false;
      startTransition(() => router.refresh());
    };

    source.addEventListener("changed", refresh);

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
