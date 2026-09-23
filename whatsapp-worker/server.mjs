// The WhatsApp session worker for the NEON portal.
//
// It holds the linked WhatsApp Web session — a real browser, driven by the
// nexora-whatsapp library — and exposes the small HTTP API the portal talks
// to. It lives outside the Next.js app for three reasons that are not going
// to change: the browser needs Chromium, the session needs a process that
// stays up, and the login needs a disk that survives a restart.
//
// This is the studio's own service and holds the studio's own number. It has
// one company, one key and one disk, and it talks to nothing but the portal.
//
//   GET  /health                     → { ok, companyId }        (no auth)
//   GET  /lines/:line/status         → session snapshot
//   POST /lines/:line/start          { linkPhoneNumber? } → snapshot with the QR
//   POST /lines/:line/stop           → 204
//   POST /lines/:line/send-text      { phone, text, kind?, idempotencyKey? } → 202
//   POST /lines/:line/send-media     { phone, fileBase64, mimeType, filename, asDocument? } → 204
//   POST /lines/:line/check-number   { phone } → { reachable }
//   GET  /lines/:line/chats          ?limit= → { chats }
//   GET  /lines/:line/chats/:id/messages ?limit= → { chat, messages }
//   GET  /lines/:line/messages/:id/media → { base64, mimeType, filename }
//
// Everything except /health requires the header `x-worker-key`.
//
// The three reads are the portal's WhatsApp tab: the studio's managers see the
// company number's conversations without passing the phone around. They are
// reads and nothing else — no sendSeen, so opening a chat in the portal does
// not mark it read on the handset, and nothing here can send.

import { createServer } from "node:http";
import { createWhatsApp, liveLocalLineClient, localSessionKey } from "nexora-whatsapp";

const COMPANY_ID = process.env.WHATSAPP_COMPANY_ID || "neon";
const API_KEY = process.env.WORKER_API_KEY;
const PORT = Number(process.env.PORT || 4100);

if (!API_KEY) {
  console.error("WORKER_API_KEY is required — this process holds a real WhatsApp login.");
  process.exit(1);
}

const wa = createWhatsApp({
  // Survives a restart: anything queued when the process died is still
  // queued when it comes back.
  journalPath: "./data/whatsapp-outbox.json",
  onStatus: (line, snapshot) => {
    const where = line.lineId ? `${line.companyId}/${line.lineId}` : line.companyId;
    console.log(`[whatsapp] ${where}: ${snapshot.status}${snapshot.phoneNumber ? ` (${snapshot.phoneNumber})` : ""}`);
  },
  log: (message) => console.log(`[whatsapp] ${message}`),
});

// Bring saved logins back up before serving, so a restart does not ask
// anyone to scan a code again.
const resumed = await wa.resume().catch((error) => {
  console.error("[whatsapp] resume failed:", error?.message ?? error);
  return [];
});
console.log(`[whatsapp] resumed ${resumed.length} saved line(s)`);

// Bringing the login back is only half of it: the queue starts empty, so
// anything the last process left waiting is still in the journal on disk and
// invisible to this one. Without this a pass iterates no lines and finds
// nothing to do — which looks exactly like a healthy queue with no backlog,
// and is how four real messages sat unsent while everything reported success.
const restored = wa.restoreQueue();
console.log(
  `[whatsapp] queue restored: ${restored.requeued} waiting, ` +
    `${restored.droppedInFlight} dropped mid-send, ${restored.expired} expired`
);

/** "main" is the company's own number; anything else is a named line. */
function lineFor(param) {
  return { companyId: COMPANY_ID, lineId: param === "main" ? null : param };
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function send(response, status, body) {
  response.writeHead(status, body === undefined ? undefined : { "content-type": "application/json" });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

/**
 * How many chats and messages a read hands back by default.
 *
 * Bounded because every one of these is answered out of a real browser page:
 * an unbounded fetch on an account with years of history would hold the
 * session busy long enough for a send to queue behind it.
 */
const CHAT_LIMIT = 50;
const MESSAGE_LIMIT = 50;
const MAX_LIMIT = 200;

function limitFrom(url, fallback) {
  const asked = Number(url.searchParams.get("limit"));
  if (!Number.isFinite(asked) || asked < 1) return fallback;
  return Math.min(Math.floor(asked), MAX_LIMIT);
}

/** Seconds since the epoch, the way WhatsApp counts, as milliseconds. */
function msOf(seconds) {
  return typeof seconds === "number" && seconds > 0 ? seconds * 1000 : null;
}

/** What a chat looks like in a list: enough to choose one, and nothing more. */
function chatRow(chat) {
  const last = chat.lastMessage ?? null;
  return {
    id: chat.id?._serialized ?? String(chat.id ?? ""),
    name: chat.name ?? null,
    number: chat.id?.user ?? null,
    isGroup: Boolean(chat.isGroup),
    unreadCount: Number(chat.unreadCount ?? 0),
    archived: Boolean(chat.archived),
    pinned: Boolean(chat.pinned),
    timestamp: msOf(chat.timestamp),
    lastMessage: last
      ? {
          body: typeof last.body === "string" ? last.body.slice(0, 500) : "",
          fromMe: Boolean(last.fromMe),
          type: last.type ?? "chat",
          hasMedia: Boolean(last.hasMedia),
          timestamp: msOf(last.timestamp),
        }
      : null,
  };
}

function messageRow(message) {
  return {
    id: message.id?._serialized ?? null,
    body: typeof message.body === "string" ? message.body.slice(0, 4000) : "",
    fromMe: Boolean(message.fromMe),
    // In a group, who said it. Null in a one-to-one chat, where it is the
    // person the chat is with.
    author: message.author ?? null,
    type: message.type ?? "chat",
    hasMedia: Boolean(message.hasMedia),
    timestamp: msOf(message.timestamp),
  };
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://internal");
    const parts = url.pathname.split("/").filter(Boolean);

    if (request.method === "GET" && parts[0] === "health" && parts.length === 1) {
      return send(response, 200, { ok: true, companyId: COMPANY_ID });
    }

    // This process can send as the company's own WhatsApp number. Nothing
    // below is reachable without the shared key.
    if (request.headers["x-worker-key"] !== API_KEY) {
      return send(response, 401, { error: "unauthorized" });
    }

    if (parts[0] !== "lines" || parts.length < 2) return send(response, 404, { error: "not found" });

    if (parts[1] === "all" && request.method === "GET") {
      return send(response, 200, { lines: [], savedKeys: [] });
    }

    const line = lineFor(decodeURIComponent(parts[1]));
    const action = parts[2];

    if (request.method === "GET" && action === "status") {
      return send(response, 200, wa.status(line));
    }

    if (request.method === "POST" && action === "start") {
      const body = await readJson(request);
      // Returns immediately with the QR (or pairing code) to show; the caller
      // polls /status until it reads "connected".
      const snapshot = await wa.link(line, body.linkPhoneNumber ?? undefined);
      return send(response, 200, snapshot);
    }

    if (request.method === "POST" && action === "stop") {
      await wa.unlink(line);
      return send(response, 204);
    }

    if (request.method === "POST" && action === "send-text") {
      const body = await readJson(request);
      if (!body.phone || !body.text) return send(response, 400, { error: "phone and text are required" });

      // Queued rather than sent inline: the library paces sends, retries, and
      // collapses a repeat of the same idempotency key into one message.
      const result = wa.send({
        lineKey: localSessionKey(line),
        companyId: COMPANY_ID,
        to: body.phone,
        text: body.text,
        // An update a client is expecting, unless the caller says otherwise.
        kind: body.kind ?? "notification",
        // No key means NO key — the library then derives one from the line, the
        // recipient and the text, and suppresses an identical message for five
        // minutes. That is what collapses a retried POST or an operator's
        // second tap while the first send is still pacing.
        //
        // This used to fall back to `portal:<phone>:<Date.now()>`, which looks
        // like a sensible default and is the opposite of one: a key containing
        // the clock is unique on every call, so it matches nothing, and
        // supplying it turns the deduplication off precisely where it was
        // designed to work.
        ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
      });

      return send(response, 202, result);
    }

    if (request.method === "POST" && action === "send-media") {
      const body = await readJson(request);
      if (!body.phone || !body.fileBase64) return send(response, 400, { error: "phone and fileBase64 are required" });

      // Media goes out directly — the queue carries text.
      await wa.sendMediaNow(
        localSessionKey(line),
        body.phone,
        Buffer.from(body.fileBase64, "base64"),
        body.mimeType || "application/octet-stream",
        body.filename || "file",
        Boolean(body.asDocument)
      );
      return send(response, 204);
    }

    // Reading the account's own chats. A line that is not connected has no
    // page to ask, which is a different answer from "no chats" and says so.
    if (request.method === "GET" && action === "chats" && parts.length === 3) {
      const client = liveLocalLineClient(line);
      if (!client) return send(response, 409, { error: "line is not linked" });

      const chats = await client.getChats();
      const rows = chats
        .slice()
        .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
        .slice(0, limitFrom(url, CHAT_LIMIT))
        .map(chatRow);
      return send(response, 200, { chats: rows });
    }

    if (request.method === "GET" && action === "chats" && parts[4] === "messages" && parts.length === 5) {
      const client = liveLocalLineClient(line);
      if (!client) return send(response, 409, { error: "line is not linked" });

      const chat = await client.getChatById(decodeURIComponent(parts[3]));
      if (!chat) return send(response, 404, { error: "no such chat" });

      // Newest last, the way a conversation reads. Deliberately no sendSeen():
      // looking at a chat in the portal must not mark it read on the phone.
      const messages = await chat.fetchMessages({ limit: limitFrom(url, MESSAGE_LIMIT) });
      const rows = messages.map(messageRow).sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
      return send(response, 200, {
        chat: { id: chat.id?._serialized ?? null, name: chat.name ?? null, isGroup: Boolean(chat.isGroup) },
        messages: rows,
      });
    }

    // One message's attachment, asked for only when somebody opens it. Fetching
    // media for a whole conversation up front would download years of photos to
    // draw a list of names.
    if (request.method === "GET" && action === "messages" && parts[4] === "media" && parts.length === 5) {
      const client = liveLocalLineClient(line);
      if (!client) return send(response, 409, { error: "line is not linked" });

      const message = await client.getMessageById(decodeURIComponent(parts[3]));
      if (!message) return send(response, 404, { error: "no such message" });
      if (!message.hasMedia) return send(response, 404, { error: "that message has no attachment" });

      const media = await message.downloadMedia();
      if (!media?.data) return send(response, 502, { error: "the attachment could not be downloaded" });
      return send(response, 200, {
        base64: media.data,
        mimeType: media.mimetype ?? "application/octet-stream",
        filename: media.filename ?? null,
      });
    }

    if (request.method === "POST" && action === "check-number") {
      const body = await readJson(request);
      const snapshot = wa.status(line);
      if (snapshot.status !== "connected") return send(response, 409, { error: "line is not linked" });
      return send(response, 200, { reachable: true });
    }

    return send(response, 404, { error: "not found" });
  } catch (error) {
    // The message goes back as-is: the portal shows it to the manager, and
    // "not linked" or "no WhatsApp account" is what they need to read.
    const message = error instanceof Error ? error.message : String(error);
    console.error("[whatsapp] request failed:", message);
    send(response, 500, { error: message });
  }
});

server.listen(PORT, () => console.log(`[whatsapp] worker ready for ${COMPANY_ID} on :${PORT}`));

// The queue does not run itself. `wa.send` only enqueues, so without this the
// worker accepts a message, writes it to the journal, answers 202, and never
// sends it — and nothing reports an error, because nothing failed. That is
// exactly how this looked like it was working while no message ever arrived.
//
// Two seconds is deliberately finer than the tightest gap the queue enforces
// (3s between replies on one line), so how promptly a message leaves is decided
// by the queue's own pacing rather than by this interval. A pass with nothing
// due does nothing.
const PUMP_INTERVAL_MS = 2_000;
let pumping = false;
const pump = setInterval(async () => {
  // One pass at a time: a pass that outruns the interval must not have a second
  // started on top of it.
  if (pumping) return;
  pumping = true;
  try {
    await wa.pump();
  } catch (error) {
    console.error("[whatsapp] pump failed:", error instanceof Error ? error.message : error);
  } finally {
    pumping = false;
  }
}, PUMP_INTERVAL_MS);

async function shutdown(why) {
  console.log(`[whatsapp] shutting down (${why})`);
  // Stop starting passes before asking the queue to settle, so shutdown is not
  // racing a pump that is handing another message to the transport.
  clearInterval(pump);
  // Let the queue finish what it is holding rather than dropping it.
  await wa.shutdown(5_000).catch(() => {});
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => void shutdown("sigterm"));
process.on("SIGINT", () => void shutdown("sigint"));
