import webpush from "web-push";
import type { PushPayload } from "@/lib/notifications/types";

// Thin wrapper over web-push. The only thing the rest of the app needs to know
// is whether a send succeeded and whether the subscription is gone for good.

export type PushTarget = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushResult =
  | { ok: true; statusCode: number }
  | { ok: false; statusCode: number | null; error: string; gone: boolean };

let configured: boolean | null = null;

export function getPublicKey() {
  return process.env.VAPID_PUBLIC_KEY ?? "";
}

/**
 * Push is optional: without VAPID keys the platform still works, it just does
 * not send to devices. In-app notifications are unaffected.
 */
export function isPushConfigured() {
  if (configured !== null) return configured;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    configured = false;
    return configured;
  }

  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:admin@neon.local",
      publicKey,
      privateKey
    );
    configured = true;
  } catch {
    configured = false;
  }
  return configured;
}

export async function sendPush(target: PushTarget, payload: PushPayload): Promise<PushResult> {
  if (!isPushConfigured()) {
    return { ok: false, statusCode: null, error: "Push is not configured (missing VAPID keys)", gone: false };
  }

  try {
    const response = await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 12 }
    );
    return { ok: true, statusCode: response.statusCode };
  } catch (error) {
    const statusCode = typeof (error as { statusCode?: number })?.statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : null;

    // 404/410 mean the browser threw the subscription away — the device will
    // never receive again, so the caller should retire it rather than retry.
    const gone = statusCode === 404 || statusCode === 410;

    return {
      ok: false,
      statusCode,
      error: error instanceof Error ? error.message : String(error),
      gone,
    };
  }
}

/**
 * What a send result means for the subscription row. Pure, so the retirement
 * policy can be tested without touching a push service.
 */
export function subscriptionOutcome(
  result: PushResult,
  failureCount: number,
  maxFailures = 10
): { active: boolean; failureCount: number; status: "SENT" | "FAILED" | "EXPIRED" } {
  if (result.ok) return { active: true, failureCount: 0, status: "SENT" };

  // 404/410: the browser dropped it. It will never work again, so stop.
  if (result.gone) return { active: false, failureCount, status: "EXPIRED" };

  // Anything else may be transient — retry, but not forever.
  const next = failureCount + 1;
  return { active: next < maxFailures, failureCount: next, status: "FAILED" };
}
