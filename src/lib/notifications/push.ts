import webpush from "web-push";
import type { PushPayload } from "@/lib/notifications/types";
import { getVapidKeys } from "@/lib/notifications/vapid";

// Thin wrapper over web-push. The only thing the rest of the app needs to know
// is whether a send succeeded and whether the subscription is gone for good.
//
// Where the signing keys come from is vapid.ts's problem: the environment when
// somebody has set it, and a pair the platform made for itself otherwise. Push
// therefore works out of the box rather than waiting on two variables nobody
// was told to set.

export type PushTarget = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushResult =
  | { ok: true; statusCode: number }
  | { ok: false; statusCode: number | null; error: string; gone: boolean };

/** The key a browser subscribes with. Empty only if the database is unreachable. */
export async function getPublicKey() {
  const keys = await getVapidKeys();
  return keys?.publicKey ?? "";
}

/**
 * Readies web-push and says whether it can send. False now means something is
 * genuinely wrong — the database is down — rather than a setup step nobody
 * knew about. In-app notifications are unaffected either way.
 */
export async function isPushConfigured() {
  const keys = await getVapidKeys();
  if (!keys) return false;

  try {
    webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
    return true;
  } catch {
    return false;
  }
}

export async function sendPush(target: PushTarget, payload: PushPayload): Promise<PushResult> {
  if (!(await isPushConfigured())) {
    return { ok: false, statusCode: null, error: "Push keys are unavailable", gone: false };
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
