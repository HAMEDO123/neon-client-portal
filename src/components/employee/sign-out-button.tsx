"use client";

import { useState, useTransition } from "react";
import { Loader, LogOut } from "lucide-react";
import { employeeLogout } from "@/lib/actions/employee-auth-actions";
import { releaseDevice } from "@/lib/actions/device-actions";
import { currentSubscription } from "@/lib/push-client";

// Signing out has to give the device up as well as the session.
//
// The browser's push subscription survives a logout, so a phone that is not
// unsubscribed keeps delivering the notifications of whoever used it last — to
// whoever picks it up next. The server row goes first: if the browser
// unsubscribes and the row survives, the account keeps pushing at an endpoint
// nobody is listening to.
export function SignOutButton() {
  const [pending, start] = useTransition();
  const [working, setWorking] = useState(false);

  async function signOut() {
    setWorking(true);
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        await releaseDevice(subscription.endpoint).catch(() => {
          // Better to sign out with a stale row than to trap somebody in a
          // session because their browser is being awkward.
        });
        await subscription.unsubscribe().catch(() => {});
      }
    } catch {
      // Same reasoning: nothing here may block signing out.
    }

    start(async () => {
      await employeeLogout();
    });
  }

  const busy = working || pending;

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-ink/12 bg-white/60 text-sm font-medium text-ink/60 transition-colors hover:text-ink disabled:opacity-60"
    >
      {busy ? <Loader size={16} className="animate-spin" strokeWidth={2} /> : <LogOut size={16} strokeWidth={1.75} />}
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
