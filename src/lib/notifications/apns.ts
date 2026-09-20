import crypto from "crypto";
import http2 from "http2";
import type { PushPayload } from "@/lib/notifications/types";

// The second push transport, beside web push.
//
// Built on Node's own http2 and crypto rather than an APNs library, on purpose:
// the platform is deployed by rebuilding a container on a PC in the studio, and
// every dependency added here is one more thing that has to install correctly
// on a machine nobody is watching. APNs is one signed JWT and one HTTP/2 POST.
//
// Shaped to mirror push.ts exactly — `isApnsConfigured`, `sendApns`, and a pure
// `deviceOutcome` that decides what a result means for the row — so the engine
// can treat the two transports the same way and neither becomes the special one.

const PRODUCTION_HOST = "https://api.push.apple.com";
const SANDBOX_HOST = "https://api.sandbox.push.apple.com";

// Apple refuses a token older than an hour and refuses being handed a fresh one
// too often, so it is regenerated well inside both bounds.
const TOKEN_TTL_MS = 45 * 60 * 1000;

export type ApnsTarget = {
  token: string;
  bundleId: string;
  sandbox: boolean;
};

export type ApnsResult =
  | { ok: true; statusCode: number }
  | { ok: false; statusCode: number | null; error: string; gone: boolean };

type ApnsConfig = { keyId: string; teamId: string; privateKey: string };

function config(): ApnsConfig | null {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  // The .p8 file's contents. Newlines survive an environment variable badly, so
  // a literal "\n" is accepted and turned back into one.
  const privateKey = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!keyId || !teamId || !privateKey) return null;
  return { keyId, teamId, privateKey };
}

/**
 * Whether APNs can send at all. False means nobody has set the three variables,
 * which is an ordinary state — the studio ran for months on web push alone —
 * and the engine simply skips this transport. It is never an error.
 */
export function isApnsConfigured(): boolean {
  return config() !== null;
}

let cachedToken: { value: string; madeAt: number } | null = null;

function authorizationToken(settings: ApnsConfig): string {
  if (cachedToken && Date.now() - cachedToken.madeAt < TOKEN_TTL_MS) {
    return cachedToken.value;
  }

  const header = { alg: "ES256", kid: settings.keyId };
  const claims = { iss: settings.teamId, iat: Math.floor(Date.now() / 1000) };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  // `ieee-p1363` is the raw r||s pair a JWT expects. Node's default for ECDSA is
  // DER, which Apple rejects with a 403 that reads like a wrong key — an hour
  // lost to looking at the key file rather than at the encoding.
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: settings.privateKey,
    dsaEncoding: "ieee-p1363",
  });

  const value = `${signingInput}.${signature.toString("base64url")}`;
  cachedToken = { value, madeAt: Date.now() };
  return value;
}

function base64url(value: string) {
  return Buffer.from(value).toString("base64url");
}

// One HTTP/2 session per gateway, kept open. Apple asks callers to reuse a
// connection rather than reconnect per notification, and a studio sending a few
// hundred a day would otherwise pay a TLS handshake for each one.
const sessions = new Map<string, http2.ClientHttp2Session>();

function sessionFor(host: string): http2.ClientHttp2Session {
  const existing = sessions.get(host);
  if (existing && !existing.closed && !existing.destroyed) return existing;

  const session = http2.connect(host);
  // A dead session must not be handed out again. Anything that ends it drops it
  // from the map, so the next send reconnects instead of writing into a socket
  // that is already gone — which would fail silently, the one failure mode that
  // matters most here.
  const forget = () => {
    if (sessions.get(host) === session) sessions.delete(host);
  };
  session.on("close", forget);
  session.on("error", forget);
  session.on("goaway", forget);

  sessions.set(host, session);
  return session;
}

export async function sendApns(target: ApnsTarget, payload: PushPayload): Promise<ApnsResult> {
  const settings = config();
  if (!settings) {
    return { ok: false, statusCode: null, error: "APNs is not configured", gone: false };
  }

  const host = target.sandbox ? SANDBOX_HOST : PRODUCTION_HOST;

  const body = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: "default",
      "thread-id": payload.tag,
    },
    // Everything the app needs to act on a tap, alongside the visible alert.
    url: payload.url,
    notificationId: payload.notificationId,
  });

  try {
    return await request(host, target, settings, body, payload.tag);
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      error: error instanceof Error ? error.message : String(error),
      gone: false,
    };
  }
}

function request(
  host: string,
  target: ApnsTarget,
  settings: ApnsConfig,
  body: string,
  collapseId: string
): Promise<ApnsResult> {
  return new Promise((resolve) => {
    const stream = sessionFor(host).request({
      ":method": "POST",
      ":path": `/3/device/${target.token}`,
      authorization: `bearer ${authorizationToken(settings)}`,
      "apns-topic": target.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 60 * 60 * 12),
      // Collapses an older notification of the same kind on the device rather
      // than stacking duplicates — web push does the same through `tag`. Apple
      // refuses the whole request if this exceeds 64 bytes, so it is cut rather
      // than allowed to fail the send over a long type name.
      "apns-collapse-id": collapseId.slice(0, 64),
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });

    let statusCode: number | null = null;
    let answer = "";

    // Never let one unanswered device hold up everybody else's notification.
    stream.setTimeout(10_000, () => {
      stream.close();
      resolve({ ok: false, statusCode: null, error: "APNs timed out", gone: false });
    });

    stream.on("response", (headers) => {
      statusCode = Number(headers[":status"]) || null;
    });
    stream.on("data", (chunk) => {
      answer += chunk;
    });
    stream.on("error", (error) => {
      resolve({ ok: false, statusCode, error: error.message, gone: false });
    });
    stream.on("end", () => {
      if (statusCode === 200) {
        resolve({ ok: true, statusCode });
        return;
      }

      const reason = readReason(answer);
      resolve({
        ok: false,
        statusCode,
        error: reason ?? `HTTP ${statusCode ?? "?"}`,
        gone: isGone(statusCode, reason),
      });
    });

    stream.end(body);
  });
}

function readReason(answer: string): string | null {
  try {
    const parsed = JSON.parse(answer) as { reason?: string };
    return typeof parsed.reason === "string" ? parsed.reason : null;
  } catch {
    return null;
  }
}

/**
 * Whether Apple is saying this device will never receive again, as opposed to
 * something that may work on the next try.
 *
 * The distinction is the whole point: retiring a token that was only
 * temporarily unreachable silently stops somebody's notifications for good,
 * and retrying one Apple has disowned wastes every send forever.
 *
 * `BadDeviceToken` deserves its name read carefully — it is also what a
 * production gateway answers for a sandbox token, which is why which gateway to
 * use is recorded on the row rather than configured globally.
 */
export function isGone(statusCode: number | null, reason: string | null): boolean {
  if (statusCode === 410) return true;
  if (statusCode !== 400) return false;
  return reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic";
}

/**
 * What a send result means for the device row. Pure, so the retirement policy
 * is testable without touching Apple — the same shape, and the same reasoning,
 * as `subscriptionOutcome` in push.ts.
 */
export function deviceOutcome(
  result: ApnsResult,
  failureCount: number,
  maxFailures = 10
): { active: boolean; failureCount: number; status: "SENT" | "FAILED" | "EXPIRED" } {
  if (result.ok) return { active: true, failureCount: 0, status: "SENT" };

  if (result.gone) return { active: false, failureCount, status: "EXPIRED" };

  const next = failureCount + 1;
  return { active: next < maxFailures, failureCount: next, status: "FAILED" };
}
