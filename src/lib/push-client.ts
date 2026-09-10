"use client";

import { savePushSubscription } from "@/lib/actions/employee-actions";
import { releaseDevice } from "@/lib/actions/device-actions";

// Turning push on, in one place.
//
// Four things can stop it before it starts — no support, no permission, no
// service worker, no subscription — and each one needs a different sentence,
// because "something went wrong" leaves somebody with no idea whether to check
// their phone settings or ask for help. Both the toggle in Profile and the
// prompt on the dashboard run this, so they cannot drift apart.
//
// iPhones get particular care, because they are the strictest: push exists only
// in an app added to the Home Screen, permission can only be asked for straight
// out of a tap, and the usual "wait for the worker" promise has been known to
// hang there on first install.

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

/** Apple's own devices — including an iPad, which describes itself as a Mac. */
export function isIOS() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Running as the installed Home Screen app rather than in a browser tab. */
export function isStandalone() {
  if (typeof window === "undefined") return false;
  const displayMode = window.matchMedia?.("(display-mode: standalone)").matches === true;
  // Older iOS reports it here instead.
  const legacy = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return displayMode || legacy;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/**
 * Resolves once the worker is running. Used instead of serviceWorker.ready,
 * which waits on whatever controls the page and has hung on iOS the first time
 * an installed app registers; this watches the registration it was handed.
 */
function activated(registration: ServiceWorkerRegistration, timeoutMs = 15_000) {
  if (registration.active) return Promise.resolve(registration);

  const worker = registration.installing ?? registration.waiting;
  if (!worker) return Promise.resolve(registration);

  return new Promise<ServiceWorkerRegistration>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new PushSetupError("The app took too long to get ready. Close it completely, open it again and retry.")),
      timeoutMs
    );

    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") {
        clearTimeout(timer);
        resolve(registration);
      } else if (worker.state === "redundant") {
        clearTimeout(timer);
        reject(new PushSetupError("The app could not finish setting up. Close it completely, open it again and retry."));
      }
    });
  });
}

/** Whether a subscription was made with the key we sign with now. */
function sameKey(existing: ArrayBuffer | null | undefined, current: Uint8Array) {
  if (!existing) return false;
  const bytes = new Uint8Array(existing);
  return bytes.length === current.length && bytes.every((value, index) => value === current[index]);
}

/** Asks, registers, subscribes and records it. Throws with something readable. */
export async function enablePush(publicKey: string) {
  if (!pushSupported()) {
    throw new PushSetupError(
      isIOS() && !isStandalone()
        ? "On iPhone, notifications only work once NEON Tasks is on your Home Screen. In Safari tap Share, then Add to Home Screen, and open it from there."
        : isIOS()
          ? "This iPhone needs iOS 16.4 or later for notifications. Update it in Settings, General, Software Update."
          : "This browser cannot receive push notifications."
    );
  }

  // Asked first and straight away. iOS shows the permission prompt only when
  // the request comes directly out of a tap; anything awaited before it would
  // spend that and the prompt would never appear.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new PushSetupError(
      permission === "denied"
        ? isIOS()
          ? "Notifications are turned off for NEON Tasks. Turn them on in Settings, Notifications, NEON Tasks."
          : "Notifications are blocked for this site. Allow them in your browser settings and try again."
        : "Notification permission was not granted."
    );
  }

  const registration = await activated(await navigator.serviceWorker.register("/sw.js", { scope: SW_SCOPE }));
  const key = urlBase64ToUint8Array(publicKey);

  // A subscription made under an older key can never receive a push signed with
  // the current one — the push service refuses it — so it is replaced rather
  // than reused, and its row is given up so it stops cluttering the device list.
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    const stale = subscription.endpoint;
    await subscription.unsubscribe().catch(() => {});
    await releaseDevice(stale).catch(() => {});
    subscription = null;
  }

  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key as BufferSource,
  });

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
