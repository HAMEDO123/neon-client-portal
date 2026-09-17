"use client";

import { useEffect, useState } from "react";
import { BellOff, BellRing, Loader } from "lucide-react";
import { ADMIN_PUSH, currentSubscription, enablePush, pushSupported } from "@/lib/push-client";
import { cn } from "@/lib/utils";

// The manager's own phone, turned on from the admin.
//
// The employee portal has had this since push existed; the manager never did,
// because there was nothing to record a subscription against and no action they
// could reach — savePushSubscription is behind requireEmployee, and the manager
// cannot sign in to the employee portal at all. So every notification addressed
// to them waited in a chat list until they next looked.
//
// The work is push-client's, shared with the employee toggle through ADMIN_PUSH
// rather than copied: the iPhone wording, waiting for the service worker, and
// replacing a subscription made under an older VAPID key are the parts that are
// easy to get wrong, and there is one of each.

type Status = "loading" | "unsupported" | "blocked" | "off" | "on" | "working";

export function AdminPushToggle({
  publicKey,
  configured,
  paired,
  devices,
}: {
  publicKey: string;
  configured: boolean;
  /** Whether there is a manager employee row to attach a phone to. */
  paired: boolean;
  /** How many of the manager's phones are receiving now. */
  devices: number;
}) {
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function check() {
      if (!configured) {
        setStatus("unsupported");
        setMessage("Push is not configured on the server yet. Notifications still arrive in the platform.");
        return;
      }
      // Said before the tap rather than after it: without that row there is no
      // id to address a notification to, and the fix is a particular one.
      if (!paired) {
        setStatus("unsupported");
        setMessage(
          "There is no manager account to attach this phone to yet. Pair yourself to the attendance device — that is what creates it."
        );
        return;
      }
      if (!pushSupported()) {
        setStatus("unsupported");
        setMessage("This browser cannot receive push. On iPhone, add this app to your Home Screen first.");
        return;
      }
      if (Notification.permission === "denied") {
        setStatus("blocked");
        setMessage("Notifications are blocked for this site in your browser settings.");
        return;
      }

      setStatus((await currentSubscription(ADMIN_PUSH)) ? "on" : "off");
    }

    check().catch(() => {
      setStatus("unsupported");
      setMessage("Push notifications are unavailable on this device.");
    });
  }, [configured, paired]);

  async function enable() {
    setStatus("working");
    setMessage(null);
    try {
      await enablePush(publicKey, ADMIN_PUSH);
      setStatus("on");
      setMessage("This device will now receive calls and private messages.");
    } catch (error) {
      const denied = error instanceof Error && /blocked|turned off/i.test(error.message);
      setStatus(denied ? "blocked" : "off");
      setMessage(error instanceof Error ? error.message : "Could not enable push on this device.");
    }
  }

  async function disable() {
    setStatus("working");
    setMessage(null);
    try {
      const subscription = await currentSubscription(ADMIN_PUSH);

      if (subscription) {
        // The server first: if the browser unsubscribes but the row survives,
        // the account keeps pushing at an endpoint nothing will answer.
        await ADMIN_PUSH.release(subscription.endpoint);
        await subscription.unsubscribe();
      }

      setStatus("off");
      setMessage("This device will no longer receive push notifications.");
    } catch {
      setStatus("on");
      setMessage("Could not turn push off on this device.");
    }
  }

  const on = status === "on";
  const busy = status === "working" || status === "loading";
  const disabled = busy || status === "unsupported" || status === "blocked";

  return (
    <section className="glass rounded-2xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            {on ? <BellRing size={16} strokeWidth={2} /> : <BellOff size={16} strokeWidth={2} />}
            Notifications on your phone
          </h2>
          <p className="mt-1 max-w-xl text-sm text-ink/50">
            Calls and private messages reach this device when the platform is closed. Each device is turned on
            separately, and {devices === 0 ? "none is receiving yet" : `${devices} ${devices === 1 ? "is" : "are"} receiving now`}.
          </p>
        </div>

        <button
          type="button"
          onClick={on ? disable : enable}
          disabled={disabled}
          aria-pressed={on}
          aria-label={on ? "Turn off notifications on this device" : "Turn on notifications on this device"}
          className={cn(
            "relative h-8 w-14 shrink-0 rounded-full border transition-colors disabled:opacity-40",
            on ? "border-emerald-600 bg-emerald-600" : "border-ink/15 bg-ink/10"
          )}
        >
          <span
            className={cn(
              "absolute top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow transition-all",
              on ? "left-[calc(100%-1.625rem)]" : "left-1"
            )}
          >
            {busy && <Loader size={12} className="animate-spin text-ink/40" strokeWidth={2.5} />}
          </span>
        </button>
      </div>

      {message && <p className="mt-3 text-xs text-ink/50">{message}</p>}

      {/* Said plainly, because it is the one thing a web app cannot do and the
          expectation it disappoints is a reasonable one. */}
      <p className="mt-3 text-[11px] text-ink/35">
        A notification is what a closed app can send. It arrives on the lock screen with the phone&apos;s own
        sound — it cannot ring like a phone call, whatever the browser.
      </p>
    </section>
  );
}
