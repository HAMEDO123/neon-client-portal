"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";

// What everybody with the platform open sees the moment a new version is
// serving: the page they are on is from the build before it, and its server
// actions belong to a server that is gone — sending a message or ticking a task
// from here would fail with nothing on screen to explain why.
//
// So it blocks rather than suggests. The page underneath keeps its state but
// cannot be used, and it reloads itself shortly whether anybody presses the
// button or not, because a phone left on a bench must come back by itself.
//
// The countdown is a CSS animation and a single timer rather than a ticking
// number: a number would mean setting state on an interval, which is the thing
// react-hooks/set-state-in-effect refuses and use-minute-now exists to avoid.

const SECONDS = 30;

export function UpdateRequired() {
  useEffect(() => {
    const timer = setTimeout(() => window.location.reload(), SECONDS * 1000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="update-required-heading"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/55 p-4 backdrop-blur-sm"
    >
      <div className="neon-rise w-full max-w-sm rounded-2xl bg-white p-5 text-center shadow-2xl">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-cyan/12 text-cyan-strong">
          <RefreshCw size={22} strokeWidth={2} aria-hidden />
        </span>

        <h2 id="update-required-heading" className="mt-3 text-lg font-semibold text-ink">
          A new version is ready
        </h2>
        <p className="mt-1.5 text-sm text-ink/60">
          The platform has been updated. Reload to carry on — this page is from the version before it.
        </p>

        <button
          type="button"
          autoFocus
          onClick={() => window.location.reload()}
          className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-ink text-sm font-semibold text-bg transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
        >
          <RefreshCw size={16} strokeWidth={2.25} aria-hidden />
          Reload now
        </button>

        <p className="mt-3 text-xs text-ink/45">Reloading on its own in {SECONDS} seconds</p>
        <div aria-hidden className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/[0.08]">
          <div
            className="h-full rounded-full bg-cyan-strong"
            // From the left, so it empties the way a clock runs down.
            style={{ transformOrigin: "left", animation: `update-countdown ${SECONDS}s linear forwards` }}
          />
        </div>
      </div>
    </div>
  );
}
