"use client";

import { useEffect, useState } from "react";
import { BellOff, BellRing, Loader, Plus, Share, X } from "lucide-react";
import { currentSubscription, enablePush, isIOS, isStandalone, pushSupported } from "@/lib/push-client";

// Notifications that nobody switched on are notifications that do not arrive.
//
// The switch lives in Profile, two taps away, so this asks on the screen
// everyone opens. And on an iPhone it has a harder job: Safari offers no push
// at all until the app is on the Home Screen, and it says nothing about it —
// the button simply is not there. So an iPhone in a browser tab is told how to
// install, step by step, instead of being shown nothing.
//
// Each card remembers being dismissed on the device, separately: waving away
// the install steps in Safari should not hide the Turn on button later.

type Mode = "install" | "update" | "blocked" | "ask";

function dismissedKey(mode: Mode) {
  return `neon.push-prompt.${mode}.dismissed`;
}

function wasDismissed(mode: Mode) {
  try {
    return localStorage.getItem(dismissedKey(mode)) === "1";
  } catch {
    // Private mode, or storage blocked. Showing it is the safer default.
    return false;
  }
}

async function decide(publicKey: string): Promise<Mode | null> {
  if (!publicKey) return null;
  // Before anything else: an iPhone in a tab cannot subscribe however it tries.
  if (isIOS() && !isStandalone()) return "install";
  if (!pushSupported()) return isIOS() ? "update" : null;
  if (Notification.permission === "denied") return "blocked";
  if (await currentSubscription()) return null;
  return "ask";
}

export function PushPrompt({ publicKey }: { publicKey: string }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    decide(publicKey)
      .then((next) => setMode(next && !wasDismissed(next) ? next : null))
      .catch(() => setMode(null));
  }, [publicKey]);

  if (!mode) return null;

  function dismiss() {
    try {
      if (mode) localStorage.setItem(dismissedKey(mode), "1");
    } catch {
      // Not remembering it is a smaller problem than crashing over it.
    }
    setMode(null);
  }

  async function turnOn() {
    setBusy(true);
    setError(null);
    try {
      await enablePush(publicKey);
      setDone(true);
      setTimeout(() => setMode(null), 1600);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not turn notifications on.");
    } finally {
      setBusy(false);
    }
  }

  const close = (
    <button
      type="button"
      onClick={dismiss}
      aria-label="Not now"
      className="absolute right-2 top-2 rounded-md p-1 text-ink/30 hover:bg-ink/5 hover:text-ink"
    >
      <X size={13} strokeWidth={2} />
    </button>
  );

  if (mode === "install") {
    return (
      <div className="glass relative rounded-2xl border border-cyan/25 bg-cyan/[0.06] p-4">
        {close}
        <p className="inline-flex items-center gap-2 pr-6 text-sm font-semibold text-ink">
          <BellRing size={16} strokeWidth={2} />
          Get notifications on this iPhone
        </p>
        <p className="mt-1 text-xs text-ink/55">
          iPhone only sends notifications to apps on your Home Screen. It takes ten seconds, once:
        </p>

        <ol className="mt-3 flex flex-col gap-2">
          <Step number={1} icon={Share}>
            Tap <strong className="font-semibold text-ink">Share</strong> at the bottom of Safari
          </Step>
          <Step number={2} icon={Plus}>
            Choose <strong className="font-semibold text-ink">Add to Home Screen</strong>, then Add
          </Step>
          <Step number={3} icon={BellRing}>
            Open <strong className="font-semibold text-ink">NEON Tasks</strong> from your Home Screen and tap Turn on
          </Step>
        </ol>

        <p className="mt-3 text-[11px] text-ink/40">
          Do it from Safari. If this page is open inside another app, open it in Safari first.
        </p>
      </div>
    );
  }

  if (mode === "update" || mode === "blocked") {
    return (
      <div className="glass relative rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
        {close}
        <p className="inline-flex items-center gap-2 pr-6 text-sm font-semibold text-ink">
          <BellOff size={16} strokeWidth={2} />
          {mode === "update" ? "This iPhone needs an update for notifications" : "Notifications are turned off"}
        </p>
        <p className="mt-1 text-xs text-ink/60">
          {mode === "update"
            ? "Notifications for Home Screen apps arrived in iOS 16.4. Update in Settings → General → Software Update, then open NEON Tasks again."
            : isIOS()
              ? "Turn them on in Settings → Notifications → NEON Tasks, then come back here."
              : "Allow notifications for this site in your browser's settings, then reload the page."}
        </p>
      </div>
    );
  }

  return (
    <div className="glass relative rounded-2xl border border-cyan/25 bg-cyan/[0.06] p-4">
      {close}
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

function Step({
  number,
  icon: Icon,
  children,
}: {
  number: number;
  icon: typeof Share;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5 text-xs text-ink/65">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-[10px] font-semibold text-bg">
        {number}
      </span>
      <Icon size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-cyan-strong" />
      <span>{children}</span>
    </li>
  );
}
