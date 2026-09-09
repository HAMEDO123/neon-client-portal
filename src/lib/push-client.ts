"use client";

import { savePushSubscription } from "@/lib/actions/employee-actions";

// Turning push on, in one place.
//
// Four things can stop it before it starts — no support, no permission, no
// service worker, no subscription — and each one needs a different sentence,
// because "something went wrong" leaves somebody with no idea whether to check
// their phone settings or ask for help. Both the toggle in Profile and the
// prompt on the dashboard run this, so they cannot drift apart.

export const SW_SCOPE = "/employee";

export class PushSetupError extends Error {}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** Asks, registers, subscribes and records it. Throws with something readable. */
export async function enablePush(publicKey: string) {
  if (!pushSupported()) {
    // The usual cause on an iPhone: Safari only allows push once the app has
    // been added to the Home Screen.
    throw new PushSetupError(
      "This browser cannot receive push. On iPhone, add this app to your Home Screen first, then try again."
    );
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new PushSetupError(
      permission === "denied"
        ? "Notifications are blocked for this site. Allow them in your browser settings and try again."
        : "Notification permission was not granted."
    );
  }

  const registration = await navigator.serviceWorker.register("/sw.js", { scope: SW_SCOPE });
  await navigator.serviceWorker.ready;

  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));

  const json = subscription.toJSON();
  if (!json.keys?.p256dh || !json.keys?.auth || !json.endpoint) {
    throw new PushSetupError("The browser returned an incomplete subscription.");
  }

  await savePushSubscription({
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    userAgent: navigator.userAgent,
  });

  return subscription;
}
