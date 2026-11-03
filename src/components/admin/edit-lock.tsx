"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen, ShieldCheck } from "lucide-react";
import { unlockEditing } from "@/lib/actions/admin-lock-actions";
import { buttonClasses } from "@/components/ui/buttons";

// The hour, on screen.
//
// The server is where the rule lives: `requireAdmin` refuses an edit once the
// hour is up, whatever any browser believes (lib/admin-guard.ts). This is the
// half that makes that bearable — it asks for the password *before* the manager
// tries to save something, rather than letting a form fail and leave them
// guessing which of their clicks did not take.
//
// It is deliberately not a modal that cannot be dismissed. A locked platform
// still reads, and the manager mostly comes to the admin to look at something;
// being made to type a password to see today's attendance would teach them to
// turn the whole thing off. So: dismissable, and then a bar that stays.

/** Inside this much of the end, the bar warns rather than waits. */
const WARN_MS = 5 * 60 * 1000;

function minutesLeft(until: number) {
  return Math.max(0, Math.ceil((until - Date.now()) / 60000));
}

export function EditLock({ unlockedUntil }: { unlockedUntil: number }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(unlockEditing, undefined);
  const [now, setNow] = useState(() => Date.now());
  // Which hour the manager waved the prompt away for, rather than a plain
  // flag. Derived state, so a fresh hour un-dismisses it by itself and nothing
  // has to be reset from an effect.
  const [dismissedFor, setDismissedFor] = useState<number | null>(null);

  // A minute's tick is enough: this counts down an hour, and a second's tick
  // would re-render the whole admin shell sixty times for the same number.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const locked = now >= unlockedUntil;
  const left = minutesLeft(unlockedUntil);

  // A fresh hour changes what the server will accept, so the page is re-read
  // rather than only re-rendered: the pages behind this were drawn by a locked
  // session and some of them hide their own buttons.
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.ok, router]);

  // Waved away for *this* hour only. Once a new one is granted the prop
  // changes and the prompt is live again, so the manager is asked at the top of
  // every hour rather than once ever.
  const dismissed = dismissedFor === unlockedUntil;

  if (!locked) {
    if (unlockedUntil - now > WARN_MS) return null;
    // Pinned to the window, not laid out in the shell: the shell is a
    // horizontal flex row sized to the viewport, and a bar placed inside it
    // becomes a column beside the sidebar. The bottom rather than the top so it
    // never sits over the navigation.
    return (
      <div className="fixed inset-x-0 bottom-0 z-[80] flex items-center justify-center gap-2 bg-amber-200/95 px-4 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] text-xs text-amber-900 backdrop-blur-sm">
        <Lock size={13} strokeWidth={2} />
        Editing locks in {left} {left === 1 ? "minute" : "minutes"}.
      </div>
    );
  }

  if (dismissed) {
    return (
      <button
        onClick={() => setDismissedFor(null)}
        className="fixed inset-x-0 bottom-0 z-[80] flex items-center justify-center gap-2 bg-red-200/95 px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-xs font-medium text-red-900 backdrop-blur-sm transition-colors hover:bg-red-300/95"
      >
        <Lock size={13} strokeWidth={2} />
        Editing is locked — enter the password to make changes
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/60 p-6 backdrop-blur-sm">
      <form action={formAction} className="glass-strong flex w-full max-w-sm flex-col gap-5 rounded-2xl p-7">
        <div>
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-cyan-strong">
            <ShieldCheck size={14} strokeWidth={2.2} />
            NEON
          </span>
          <h2 className="mt-2 text-base font-semibold text-ink">Enter your password to make changes</h2>
          <p className="mt-1 text-sm text-ink/55">
            Editing is open for an hour at a time. Nothing can be changed until you enter it — the screens
            stay readable.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="unlock-password" className="text-sm font-medium text-ink/70">
            Admin password
          </label>
          <input
            id="unlock-password"
            name="password"
            type="password"
            required
            autoFocus
            autoComplete="current-password"
            className="rounded-lg border border-ink/15 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
          />
        </div>

        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

        <div className="flex flex-col gap-2">
          <button type="submit" disabled={pending} className={buttonClasses("primary", "md", "w-full")}>
            <LockOpen size={15} strokeWidth={2} />
            {pending ? "Unlocking…" : "Unlock editing"}
          </button>
          <button
            type="button"
            onClick={() => setDismissedFor(unlockedUntil)}
            className="text-xs font-medium text-ink/45 transition-colors hover:text-ink/70"
          >
            Just looking — browse without editing
          </button>
        </div>
      </form>
    </div>
  );
}
