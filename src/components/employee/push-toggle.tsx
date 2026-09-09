"use client";

import { useEffect, useState } from "react";
import { BellOff, BellRing, Loader } from "lucide-react";
import { removePushSubscription, savePushSubscription } from "@/lib/actions/employee-actions";
import { cn } from "@/lib/utils";

// Turning on push has four ways to fail before it can succeed: no support, no
// permission, no service worker, no subscription. Each one gets a specific
// message, because "something went wrong" leaves an employee with no idea
// whether to check their phone settings or call someone.

type Status = "loading" | "unsupported" | "blocked" | "off" | "on" | "working";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

export function PushToggle({ publicKey, configured }: { publicKey: string; configured: boolean }) {
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function check() {
      if (!configured) {
        setStatus("unsupported");
        setMessage("Push is not configured on the server yet. In-app notifications still work.");
        return;
      }
      if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("unsupported");
        // The usual cause on an iPhone: Safari only allows push once the app
        // has been added to the Home Screen.
        setMessage("This browser cannot receive push. On iPhone, add this app to your Home Screen first.");
        return;
      }
      if (Notification.permission === "denied") {
        setStatus("blocked");
        setMessage("Notifications are blocked for this site in your browser settings.");
        return;
      }

      const registration = await navigator.serviceWorker.getRegistration("/employee");
      const existing = await registration?.pushManager.getSubscription();
      setStatus(existing ? "on" : "off");
    }

    check().catch(() => {
      setStatus("unsupported");
      setMessage("Push notifications are unavailable on this device.");
    });
  }, [configured]);

  async function enable() {
    setStatus("working");
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "blocked" : "off");
        setMessage("Notification permission was not granted.");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/employee" });
      await navigator.serviceWorker.ready;

      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        }));

      const json = subscription.toJSON();
      if (!json.keys?.p256dh || !json.keys?.auth || !json.endpoint) {
        throw new Error("The browser returned an incomplete subscription.");
      }

      await savePushSubscription({
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        userAgent: navigator.userAgent,
      });

      setStatus("on");
      setMessage("This device will now receive notifications.");
    } catch (error) {
      setStatus("off");
      setMessage(error instanceof Error ? error.message : "Could not enable push on this device.");
    }
  }

  async function disable() {
    setStatus("working");
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/employee");
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        // Tell the server first: if the browser unsubscribes but the row
        // survives, the account keeps pushing at a dead endpoint.
        await removePushSubscription(subscription.endpoint);
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
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            {on ? <BellRing size={16} strokeWidth={2} /> : <BellOff size={16} strokeWidth={2} />}
            Push notifications
          </p>
          <p className="mt-0.5 text-xs text-ink/50">
            {on ? "Enabled on this device" : "Get task alerts on this device"}
          </p>
        </div>

        <button
          type="button"
          onClick={on ? disable : enable}
          disabled={disabled}
          aria-pressed={on}
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

      <p className="mt-3 text-[11px] text-ink/35">
        Each device is enabled separately, and all of your enabled devices receive the same notifications.
      </p>
    </div>
  );
}
