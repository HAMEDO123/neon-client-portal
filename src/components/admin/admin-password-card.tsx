"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Lock } from "lucide-react";
import { changeAdminPassword, lockEditingNow } from "@/lib/actions/admin-lock-actions";
import { buttonClasses } from "@/components/ui/buttons";

// The manager's own password, on the settings page.
//
// The current password is asked for even though this page is behind the admin
// session, and the reason is the whole point of the screen: the platform runs
// on a PC in the studio, and a browser left signed in on it must not be able to
// change the password and lock the manager out of their own platform.

export function AdminPasswordCard({
  usingOwnPassword,
  minLength,
  unlockMinutes,
}: {
  /** False while the platform is still on the password it was deployed with. */
  usingOwnPassword: boolean;
  minLength: number;
  unlockMinutes: number;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(changeAdminPassword, undefined);
  const [locking, setLocking] = useState(false);

  // A new password re-signs this browser's session and ends every other one, so
  // the page is re-read rather than left showing the state from before.
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.ok, router]);

  return (
    <section className="glass rounded-2xl p-6">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
        <KeyRound size={16} strokeWidth={2} />
        Admin password
      </h2>
      <p className="mt-1 text-sm text-ink/50">
        Changing it signs out every other admin session at once — this browser, the phone app, and any
        window left open somewhere else. Editing then stays open for {unlockMinutes} minutes at a time; after
        that the platform asks for this password again before it will accept a change.
      </p>

      {!usingOwnPassword && (
        <p className="mt-3 rounded-lg bg-amber-500/12 px-3 py-2 text-xs text-amber-900">
          This is still the password the platform was set up with, stored in the deployment&apos;s own
          configuration. Set your own here and it moves into the database, where only this screen can change
          it.
        </p>
      )}

      <form action={formAction} className="mt-4 flex flex-col gap-3 sm:max-w-sm">
        <label>
          <span className="mb-1 block text-xs font-medium text-ink/50">Current password</span>
          <input
            name="current"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-ink/50">
            New password ({minLength} characters or more)
          </span>
          <input
            name="next"
            type="password"
            required
            minLength={minLength}
            autoComplete="new-password"
            className="w-full rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-ink/50">New password again</span>
          <input
            name="confirm"
            type="password"
            required
            minLength={minLength}
            autoComplete="new-password"
            className="w-full rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
          />
        </label>

        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state?.ok && (
          <p className="text-sm text-emerald-700">
            Saved. Every other admin session has been signed out; you are still in.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={pending} className={buttonClasses("primary", "md")}>
            {pending ? "Saving…" : "Change password"}
          </button>
          <button
            type="button"
            disabled={locking}
            onClick={async () => {
              setLocking(true);
              await lockEditingNow();
              setLocking(false);
              router.refresh();
            }}
            className={buttonClasses("ghost", "md")}
          >
            <Lock size={15} strokeWidth={2} />
            {locking ? "Locking…" : "Lock editing now"}
          </button>
        </div>
      </form>

      <p className="mt-3 text-xs text-ink/40">
        &ldquo;Lock editing now&rdquo; closes the window without signing out — the screens stay readable and
        the next change asks for the password. Worth pressing before you walk away from a shared PC.
      </p>
    </section>
  );
}
