// Client for NEON's own WhatsApp worker (whatsapp-worker/ in this repo).
//
// The worker holds a real whatsapp-web.js browser session and exposes a small
// HTTP API; it serves one company — this one — and the line in the path is
// either "main" (the studio's own number) or a named line. It is a separate
// service because a Next.js app on Render cannot host a browser, a process that
// stays up, or a disk that survives a restart, and the session needs all three.
//
// It is the studio's own service: its own key, its own session, its own disk.
// Nothing here reaches into another product's deployment.
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
    // `kind` is the library's whole safety model, so it is stated here rather
    // than left to a default at the other end. The caller is the only side that
    // knows what a message actually is, and a default is a guess made by
    // something that does not. Everything the portal sends is business-initiated
    // to a client who already has a relationship with the studio:
    // `notification`, never `cold`.
    body: { phone: to, text, kind: "notification" },
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

// Reading the company number's conversations.
//
// The portal's WhatsApp tab is a window onto the account the worker already
// holds, not a copy of it: every read below asks WhatsApp Web's own store
// through the live session, so there is no second inbox to keep in step and
// nothing on this side to go stale. It also means the tab is only as available
// as the session — a line that is not linked answers "not linked", which is
// the truth and not an empty list.
//
// Read-only, all the way down. The worker never calls sendSeen for these, so
// opening a chat here does not mark it read on the phone.

export type WhatsAppChat = {
  id: string;
  name: string | null;
  /** The other party's number, digits only. Null for a group. */
  number: string | null;
  isGroup: boolean;
  unreadCount: number;
  archived: boolean;
  pinned: boolean;
  /** When the chat last moved, in milliseconds. */
  timestamp: number | null;
  lastMessage: {
    body: string;
    fromMe: boolean;
    type: string;
    hasMedia: boolean;
    timestamp: number | null;
  } | null;
};

export type WhatsAppChatMessage = {
  id: string | null;
  body: string;
  fromMe: boolean;
  /** In a group, who said it. Null in a one-to-one chat. */
  author: string | null;
  type: string;
  hasMedia: boolean;
  timestamp: number | null;
};

function lineCall<T>(path: string, timeoutMs: number) {
  const config = getWhatsAppConfig();
  if (!config) {
    return Promise.resolve<WhatsAppResult<T>>({ ok: false, error: "No WhatsApp worker is configured." });
  }
  return call<T>(`/lines/${encodeURIComponent(config.line)}${path}`, { method: "GET", timeoutMs });
}

/** The account's conversations, most recently active first. */
export function whatsAppChats(limit = 50) {
  // Asking a real browser page for its chat list is slower than a database
  // read and much faster than launching anything.
  return lineCall<{ chats: WhatsAppChat[] }>(`/chats?limit=${limit}`, 20_000);
}

/** One conversation, oldest message first — the way it reads on a phone. */
export function whatsAppChatMessages(chatId: string, limit = 50) {
  return lineCall<{
    chat: { id: string | null; name: string | null; isGroup: boolean };
    messages: WhatsAppChatMessage[];
  }>(`/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`, 25_000);
}

/**
 * One message's attachment, fetched only when somebody opens it.
 *
 * Downloading media for a whole conversation up front would pull years of
 * photos through the session to draw a list of names.
 */
export function whatsAppMessageMedia(messageId: string) {
  return lineCall<{ base64: string; mimeType: string; filename: string | null }>(
    `/messages/${encodeURIComponent(messageId)}/media`,
    45_000
  );
}

/**
 * Answers in one of the company number's conversations, as the studio.
 *
 * Addressed by the chat's own id rather than by digits, which is what makes a
 * modern `@lid` conversation reachable at all — its `user` is a LID, not a
 * phone number, so rebuilding an address from digits would send to nobody.
 * The library keeps a JID intact and resolves it; a group's `@g.us` it refuses
 * outright, which is a rule of its own and left alone (see `toJid`).
 *
 * `kind` is the library's whole safety model and the caller decides it, so it
 * is a required argument here rather than a default: "reply" is uncapped and
 * true of a conversation somebody else has written in, "notification" is for
 * one where only we have. Nothing from this screen is ever "cold" — a person
 * is typing into a conversation that already exists.
 *
 * Queued, not sent: the answer is 202 and the message leaves when the queue's
 * pacing allows. Whoever shows this has to say "sending" rather than "sent".
 */
export function sendWhatsAppChatMessage(chatId: string, text: string, kind: "reply" | "notification") {
  const config = getWhatsAppConfig();
  if (!config) return Promise.resolve<WhatsAppResult>({ ok: false, error: "No WhatsApp worker is configured." });

  return call(`/lines/${encodeURIComponent(config.line)}/send-text`, {
    method: "POST",
    body: { phone: chatId, text, kind },
    timeoutMs: 30_000,
  });
}
