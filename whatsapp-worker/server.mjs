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
import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
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

/**
 * Clears the lock files Chromium leaves behind when it is killed rather than
 * closed.
 *
 * A container that is recreated — every rebuild of this worker — takes its
 * browser down with it without letting it tidy up, so `SingletonLock`,
 * `SingletonSocket` and `SingletonCookie` stay on the volume pointing at a
 * process that no longer exists. The next launch reads them as "another
 * Chromium already has this profile" and the target closes during injection:
 *
 *   TargetCloseError: Protocol error (Page.addScriptToEvaluateOnNewDocument)
 *
 * which says nothing about locks and reads as a broken login. The session is
 * perfectly fine underneath — it came back the moment these were removed.
 *
 * Safe here and nowhere else: this runs once, at boot, before any browser of
 * ours has been launched, so a lock found now is by definition stale.
 */
function clearStaleBrowserLocks() {
  const sessions = path.join(process.cwd(), "data", "whatsapp-sessions");
  const LOCKS = ["SingletonLock", "SingletonSocket", "SingletonCookie"];

  let profiles = [];
  try {
    profiles = readdirSync(sessions);
  } catch {
    return; // No sessions on disk yet, which is the ordinary first boot.
  }

  let cleared = 0;
  for (const profile of profiles) {
    for (const lock of LOCKS) {
      const file = path.join(sessions, profile, lock);
      try {
        statSync(file, { throwIfNoEntry: true });
      } catch {
        continue;
      }
      try {
        rmSync(file, { force: true });
        cleared += 1;
      } catch (error) {
        console.error(`[whatsapp] could not clear ${lock} for ${profile}:`, error?.message ?? error);
      }
    }
  }

  if (cleared > 0) console.log(`[whatsapp] cleared ${cleared} stale browser lock(s)`);
}

clearStaleBrowserLocks();

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

/**
 * The chat list, read straight out of WhatsApp Web's own store.
 *
 * NOT `client.getChats()`, and the difference is the whole point. That maps
 * every chat through whatsapp-web.js's model builder, which calls into
 * WhatsApp Web's minified modules — group metadata, LID migration, the link
 * finder — and when one of those is renamed (which happens, and is what the
 * session module's `messageIdString` comment is about) the call throws a
 * one-letter minified error and the entire list is lost. That is exactly how
 * this first failed: `{"error":"r"}`, with a perfectly healthy session behind
 * it.
 *
 * So this reads the fields it actually needs off each chat's own `serialize()`,
 * requires nothing, and wraps every row in its own try/catch — one unreadable
 * conversation costs that conversation, never the list.
 */
function readChats(client, limit) {
  return client.pupPage.evaluate((max) => {
    const chats = window.require("WAWebCollections").Chat.getModelsArray();
    const newestFirst = chats.slice().sort((a, b) => Number(b.t ?? 0) - Number(a.t ?? 0));

    const rows = [];
    for (const chat of newestFirst.slice(0, max)) {
      try {
        const id = chat.id?._serialized;
        if (!id) continue;

        let lastMessage = null;
        try {
          const msgs = chat.msgs?.getModelsArray?.() ?? [];
          const last = msgs.length ? msgs[msgs.length - 1] : null;
          if (last) {
            const data = last.serialize();
            // Media carries its text in the caption, exactly as the library
            // reads it (Message.js: hasMedia = Boolean(directPath)).
            const hasMedia = Boolean(data.directPath);
            const text = hasMedia ? data.caption : data.body;
            lastMessage = {
              body: typeof text === "string" ? text.slice(0, 500) : "",
              fromMe: Boolean(data.id?.fromMe),
              type: data.type ?? "chat",
              hasMedia,
              timestamp: Number(data.t ?? 0),
            };
          }
        } catch {
          // A chat whose newest message will not serialise is still a chat.
        }

        rows.push({
          id,
          name: chat.formattedTitle ?? chat.name ?? null,
          number: chat.id?.user ?? null,
          isGroup: chat.id?.server === "g.us",
          unreadCount: Number(chat.unreadCount ?? 0),
          archived: Boolean(chat.archive),
          pinned: Boolean(chat.pin),
          timestamp: Number(chat.t ?? 0),
          lastMessage,
        });
      } catch {
        // One unreadable chat must not cost the whole list.
      }
    }
    return rows;
  }, limit);
}

/**
 * One conversation's messages, oldest last, read the same way.
 *
 * What is already in the store comes back first; reaching further back needs
 * WhatsApp Web's own loader, so that call is guarded on its own — a history
 * that will not load further still hands over the part that did.
 */
function readMessages(client, chatId, limit) {
  return client.pupPage.evaluate(
    async (id, max) => {
      const chat = window.require("WAWebCollections").Chat.get(id);
      if (!chat) return null;

      /**
       * A message's id as the string WhatsApp Web's own store is keyed by.
       *
       * The same trap the session module's `messageIdString` documents, hit
       * again from this side: WhatsApp Web no longer serialises `_serialized`
       * on a MsgKey, so reading `data.id._serialized` off `serialize()` gives
       * null for every message — and an attachment with no id cannot be
       * fetched. The canonical form always begins "true_" or "false_", which
       * is what makes it findable whatever it is called this month; failing
       * that it is rebuilt from the parts, which WhatsApp cannot rename
       * without breaking its own clients.
       */
      const keyOf = (key) => {
        if (!key) return null;
        if (typeof key._serialized === "string") return key._serialized;

        for (const value of Object.values(key)) {
          if (typeof value === "string" && /^(true|false)_.+_/.test(value)) return value;
        }

        const remote = key.remote?._serialized ?? key.remote;
        if (!remote || !key.id) return null;
        const base = `${Boolean(key.fromMe)}_${remote}_${key.id}`;
        const participant = key.participant?._serialized ?? key.participant;
        return participant ? `${base}_${participant}` : base;
      };

      const real = (m) => {
        try {
          return !m.isNotification;
        } catch {
          return true;
        }
      };

      let msgs = (chat.msgs?.getModelsArray?.() ?? []).filter(real);

      try {
        const loader = window.require("WAWebChatLoadMessages");
        while (msgs.length < max) {
          const earlier = await loader.loadEarlierMsgs({ chat });
          if (!earlier || !earlier.length) break;
          msgs = [...earlier.filter(real), ...msgs];
        }
      } catch {
        // Older messages could not be loaded. What is here is still true.
      }

      msgs.sort((a, b) => Number(a.t ?? 0) - Number(b.t ?? 0));
      if (msgs.length > max) msgs = msgs.slice(msgs.length - max);

      const rows = [];
      for (const message of msgs) {
        try {
          const data = message.serialize();
          const hasMedia = Boolean(data.directPath);
          const text = hasMedia ? data.caption : data.body;
          rows.push({
            // From the live key, not the serialised copy: `_serialized` is a
            // getter that does not survive being handed back out of the page.
            id: keyOf(message.id) ?? keyOf(data.id),
            body: typeof text === "string" ? text.slice(0, 4000) : "",
            fromMe: Boolean(data.id?.fromMe),
            // In a group, who said it. Null in a one-to-one chat.
            author: typeof data.author === "string" ? data.author : data.author?._serialized ?? null,
            type: data.type ?? "chat",
            hasMedia,
            timestamp: Number(data.t ?? 0),
          });
        } catch {
          // One message that will not serialise must not lose the thread.
        }
      }

      return {
        chat: {
          id: chat.id?._serialized ?? null,
          name: chat.formattedTitle ?? chat.name ?? null,
          isGroup: chat.id?.server === "g.us",
        },
        messages: rows,
      };
    },
    chatId,
    limit
  );
}

/**
 * One message's attachment, decrypted in the page.
 *
 * Deliberately not `client.getMessageById(id).downloadMedia()`: building the
 * Message object first goes through the library's model builder and the link
 * finder it requires, which is the call that fails minified — the download
 * underneath does not. So this does what `Message.downloadMedia` does and
 * nothing it does not: find the message in the store, resolve the media if it
 * is not resolved yet, and decrypt it.
 */
function readMedia(client, messageId) {
  return client.pupPage.evaluate(async (id) => {
    const store = window.require("WAWebCollections");
    const msg = store.Msg.get(id) || (await store.Msg.getMessagesById([id]))?.messages?.[0];

    // REUPLOADING means the media has expired and WhatsApp is fetching it
    // again — there is nothing to hand over yet.
    if (!msg || !msg.mediaData || msg.mediaData.mediaStage === "REUPLOADING") return null;

    if (msg.mediaData.mediaStage !== "RESOLVED") {
      await msg.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1 });
    }
    if (msg.mediaData.mediaStage.includes("ERROR") || msg.mediaData.mediaStage === "FETCHING") {
      return null;
    }

    // The download manager expects a performance-logging object it can call
    // through; it is never read here.
    const noQpl = {
      addAnnotations() {
        return this;
      },
      addPoint() {
        return this;
      },
    };

    const decrypted = await window.require("WAWebDownloadManager").downloadManager.downloadAndMaybeDecrypt({
      directPath: msg.directPath,
      encFilehash: msg.encFilehash,
      filehash: msg.filehash,
      mediaKey: msg.mediaKey,
      mediaKeyTimestamp: msg.mediaKeyTimestamp,
      type: msg.type,
      signal: new AbortController().signal,
      downloadQpl: noQpl,
    });

    return {
      base64: await window.WWebJS.arrayBufferToBase64Async(decrypted),
      mimeType: msg.mimetype ?? "application/octet-stream",
      filename: msg.filename ?? null,
    };
  }, messageId);
}

/** Seconds as WhatsApp counts them, in milliseconds, or null. */
function withMs(row) {
  return { ...row, timestamp: msOf(row.timestamp) };
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

      const rows = await readChats(client, limitFrom(url, CHAT_LIMIT));
      return send(response, 200, {
        chats: rows.map((chat) => ({
          ...withMs(chat),
          lastMessage: chat.lastMessage ? withMs(chat.lastMessage) : null,
        })),
      });
    }

    if (request.method === "GET" && action === "chats" && parts[4] === "messages" && parts.length === 5) {
      const client = liveLocalLineClient(line);
      if (!client) return send(response, 409, { error: "line is not linked" });

      // Newest last, the way a conversation reads. Deliberately no sendSeen():
      // looking at a chat in the portal must not mark it read on the phone.
      const found = await readMessages(client, decodeURIComponent(parts[3]), limitFrom(url, MESSAGE_LIMIT));
      if (!found) return send(response, 404, { error: "no such chat" });

      return send(response, 200, { chat: found.chat, messages: found.messages.map(withMs) });
    }

    // One message's attachment, asked for only when somebody opens it. Fetching
    // media for a whole conversation up front would download years of photos to
    // draw a list of names.
    if (request.method === "GET" && action === "messages" && parts[4] === "media" && parts.length === 5) {
      const client = liveLocalLineClient(line);
      if (!client) return send(response, 409, { error: "line is not linked" });

      const media = await readMedia(client, decodeURIComponent(parts[3]));
      if (!media?.base64) return send(response, 404, { error: "that attachment is not available" });
      return send(response, 200, media);
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
    // WhatsApp Web throws minified errors — the first of these read exactly
    // "r" — so the message alone says nothing. The stack names the call.
    console.error("[whatsapp] request failed:", message, error instanceof Error ? error.stack : "");
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
