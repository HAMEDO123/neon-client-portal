// Client for the WhatsApp worker that already runs for Nixora.
//
// That worker holds a real whatsapp-web.js browser session and exposes a small
// HTTP API; it serves exactly one company, and the line in the path is either
// "main" (the company's own line) or an employee's line id. Rather than stand
// up a second Chromium session here — which a Next.js app on Render cannot
// host anyway — this portal talks to that worker.
//
// Contract, from whatsapp-worker/worker.ts:
//   GET  /health                        → { ok, companyId }        (no auth)
//   GET  /lines/all                     → { lines, savedKeys }
//   GET  /lines/:line/status            → status snapshot
//   POST /lines/:line/send-text         { phone, text, typingDelayMs? } → 204
//   POST /lines/:line/send-media        { phone, fileBase64, mimeType, filename, asDocument? } → 204
//   POST /lines/:line/check-number      { phone } → { reachable }
// Everything except /health requires the header `x-worker-key`.

export type WhatsAppConfig = {
  baseUrl: string;
  apiKey: string;
  line: string;
};

export type WhatsAppResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

export function getWhatsAppConfig(): WhatsAppConfig | null {
  const baseUrl = process.env.WHATSAPP_WORKER_URL?.replace(/\/$/, "");
  const apiKey = process.env.WHATSAPP_WORKER_KEY;
  if (!baseUrl || !apiKey) return null;

  // "main" is the company's own line unless a specific employee line is named.
  return { baseUrl, apiKey, line: process.env.WHATSAPP_LINE_ID || "main" };
}

export function isWhatsAppConfigured() {
  return getWhatsAppConfig() !== null;
}

/** Digits only, the way WhatsApp addresses a number. */
export function normalisePhone(phone: string | null | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

async function call<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; timeoutMs?: number } = { method: "GET" }
): Promise<WhatsAppResult<T>> {
  const config = getWhatsAppConfig();
  if (!config) return { ok: false, error: "WhatsApp is not configured on this deployment." };

  // The worker drives a real browser; a send can take a few seconds, but it
  // must never hang a page render indefinitely.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 20_000);

  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: init.method,
      headers: {
        "x-worker-key": config.apiKey,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      // The worker returns its failure message verbatim — "not linked",
      // "No LID for user" and so on — which is far more useful than a code.
      const detail = await response.json().catch(() => null);
      return {
        ok: false,
        status: response.status,
        error:
          (detail as { error?: string } | null)?.error ??
          (response.status === 401 ? "The worker rejected the API key." : `Worker returned ${response.status}.`),
      };
    }

    if (response.status === 204) return { ok: true, data: undefined as T };
    return { ok: true, data: (await response.json()) as T };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "The WhatsApp worker did not respond in time." };
    }
    return {
      ok: false,
      error: error instanceof Error ? `Could not reach the WhatsApp worker: ${error.message}` : "Could not reach the WhatsApp worker.",
    };
  } finally {
    // However the request ended, the abort timer must not outlive it.
    clearTimeout(timeout);
  }
}

export function whatsAppHealth() {
  return call<{ ok: boolean; companyId: string }>("/health", { method: "GET", timeoutMs: 8000 });
}

export function whatsAppLines() {
  return call<{ lines: unknown[]; savedKeys: unknown[] }>("/lines/all", { method: "GET", timeoutMs: 8000 });
}

export function whatsAppLineStatus() {
  const config = getWhatsAppConfig();
  if (!config) return Promise.resolve<WhatsAppResult<unknown>>({ ok: false, error: "WhatsApp is not configured." });
  return call<unknown>(`/lines/${encodeURIComponent(config.line)}/status`, { method: "GET", timeoutMs: 8000 });
}

export async function sendWhatsAppText(phone: string, text: string): Promise<WhatsAppResult> {
  const config = getWhatsAppConfig();
  if (!config) return { ok: false, error: "WhatsApp is not configured on this deployment." };

  const to = normalisePhone(phone);
  if (!to) return { ok: false, error: "That phone number does not look valid." };

  return call(`/lines/${encodeURIComponent(config.line)}/send-text`, {
    method: "POST",
    body: { phone: to, text },
    timeoutMs: 30_000,
  });
}

export async function sendWhatsAppMedia(
  phone: string,
  file: { base64: string; mimeType: string; filename: string; asDocument?: boolean }
): Promise<WhatsAppResult> {
  const config = getWhatsAppConfig();
  if (!config) return { ok: false, error: "WhatsApp is not configured on this deployment." };

  const to = normalisePhone(phone);
  if (!to) return { ok: false, error: "That phone number does not look valid." };

  return call(`/lines/${encodeURIComponent(config.line)}/send-media`, {
    method: "POST",
    body: {
      phone: to,
      fileBase64: file.base64,
      mimeType: file.mimeType,
      filename: file.filename,
      asDocument: file.asDocument ?? false,
    },
    timeoutMs: 60_000,
  });
}

export async function checkWhatsAppNumber(phone: string): Promise<WhatsAppResult<{ reachable: boolean }>> {
  const config = getWhatsAppConfig();
  if (!config) return { ok: false, error: "WhatsApp is not configured on this deployment." };

  const to = normalisePhone(phone);
  if (!to) return { ok: false, error: "That phone number does not look valid." };

  return call<{ reachable: boolean }>(`/lines/${encodeURIComponent(config.line)}/check-number`, {
    method: "POST",
    body: { phone: to },
    timeoutMs: 15_000,
  });
}

// --- Linking a number ------------------------------------------------------
// The worker holds the session; these drive it from the portal's Settings.

export type LineSnapshot = {
  status: "disconnected" | "pending" | "connected" | "error" | string;
  qrDataUrl: string | null;
  pairingCode: string | null;
  phoneNumber: string | null;
  error?: string | null;
};

/**
 * Starts linking and returns the QR to show. The caller polls `lineStatus`
 * until it reads "connected" — the scan happens on the phone, so there is
 * nothing to await here.
 */
export function startWhatsAppLink(linkPhoneNumber?: string) {
  const config = getWhatsAppConfig();
  if (!config) {
    return Promise.resolve<WhatsAppResult<LineSnapshot>>({
      ok: false,
      error: "No WhatsApp worker is configured.",
    });
  }

  return call<LineSnapshot>(`/lines/${encodeURIComponent(config.line)}/start`, {
    method: "POST",
    body: linkPhoneNumber ? { linkPhoneNumber } : {},
    // Launching a browser and producing the first QR is not instant.
    timeoutMs: 90_000,
  });
}

export function lineStatus() {
  const config = getWhatsAppConfig();
  if (!config) {
    return Promise.resolve<WhatsAppResult<LineSnapshot>>({
      ok: false,
      error: "No WhatsApp worker is configured.",
    });
  }
  return call<LineSnapshot>(`/lines/${encodeURIComponent(config.line)}/status`, {
    method: "GET",
    timeoutMs: 10_000,
  });
}

export function stopWhatsAppLink() {
  const config = getWhatsAppConfig();
  if (!config) {
    return Promise.resolve<WhatsAppResult>({ ok: false, error: "No WhatsApp worker is configured." });
  }
  return call(`/lines/${encodeURIComponent(config.line)}/stop`, { method: "POST", timeoutMs: 30_000 });
}
