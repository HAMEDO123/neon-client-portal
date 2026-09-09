"use client";

import { useEffect, useState } from "react";
import { BellRing, Loader, X } from "lucide-react";
import { currentSubscription, enablePush, pushSupported } from "@/lib/push-client";

// Notifications that nobody switched on are notifications that do not arrive.
//
// The switch lives in Profile, which is two taps away and easy never to find,
// so this asks once on the screen everyone opens. Dismissing it is remembered
// on the device — being nagged daily about a setting you have decided against
// is worse than missing it.

const DISMISSED = "neon.push-prompt.dismissed";

export function PushPrompt({ publicKey }: { publicKey: string }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    async function check() {
      if (!publicKey || !pushSupported()) return;
      if (Notification.permission === "denied") return;

      let dismissed = false;
      try {
        dismissed = localStorage.getItem(DISMISSED) === "1";
      } catch {
        // Private mode, or storage blocked. Asking once is the safer default.
      }
      if (dismissed) return;

      if (await currentSubscription()) return;
      setShow(true);
    }

    check().catch(() => {
      // A browser that cannot answer is a browser that cannot subscribe.
    });
  }, [publicKey]);

  if (!show) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      // Not remembering it is a smaller problem than crashing over it.
    }
    setShow(false);
  }

  async function turnOn() {
    setBusy(true);
    setError(null);
    try {
      await enablePush(publicKey);
      setDone(true);
      setTimeout(() => setShow(false), 1600);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not turn notifications on.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass relative rounded-2xl border border-cyan/25 bg-cyan/[0.06] p-4">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Not now"
        className="absolute right-2 top-2 rounded-md p-1 text-ink/30 hover:bg-ink/5 hover:text-ink"
      >
        <X size={13} strokeWidth={2} />
      </button>

      <p className="inline-flex items-center gap-2 pr-6 text-sm font-semibold text-ink">
        <BellRing size={16} strokeWidth={2} />
        {done ? "Notifications are on" : "Turn on notifications"}
      </p>
      <p className="mt-1 text-xs text-ink/55">
        {done
          ? "This device will get your tasks as they come."
          : "Get new tasks and deadlines on this phone, even with the app closed."}
      </p>

      {error && <p className="mt-2 text-xs font-medium text-pink-strong">{error}</p>}

      {!done && (
        <button
          type="button"
          onClick={turnOn}
          disabled={busy}
          className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-semibold text-bg disabled:opacity-60"
        >
          {busy && <Loader size={14} className="animate-spin" strokeWidth={2.5} />}
          {busy ? "Turning on…" : "Turn on"}
        </button>
      )}
    </div>
  );
}
