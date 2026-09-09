// The WhatsApp session worker for the NEON portal.
//
// It holds the linked WhatsApp Web session — a real browser, driven by the
// nexora-whatsapp library — and exposes the small HTTP API the portal talks
// to. It lives outside the Next.js app for three reasons that are not going
// to change: the browser needs Chromium, the session needs a process that
// stays up, and the login needs a disk that survives a restart.
//
// The API is deliberately the same shape as the worker that already runs for
// Nixora, so the portal's client speaks to either without knowing which.
//
//   GET  /health                     → { ok, companyId }        (no auth)
//   GET  /lines/:line/status         → session snapshot
//   POST /lines/:line/start          { linkPhoneNumber? } → snapshot with the QR
//   POST /lines/:line/stop           → 204
//   POST /lines/:line/send-text      { phone, text, kind?, idempotencyKey? } → 202
//   POST /lines/:line/send-media     { phone, fileBase64, mimeType, filename, asDocument? } → 204
//   POST /lines/:line/check-number   { phone } → { reachable }
//
// Everything except /health requires the header `x-worker-key`.

import { createServer } from "node:http";
import { createWhatsApp, localSessionKey } from "nexora-whatsapp";

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
        idempotencyKey: body.idempotencyKey ?? `portal:${body.phone}:${Date.now()}`,
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

async function shutdown(why) {
  console.log(`[whatsapp] shutting down (${why})`);
  // Let the queue finish what it is holding rather than dropping it.
  await wa.shutdown(5_000).catch(() => {});
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => void shutdown("sigterm"));
process.on("SIGINT", () => void shutdown("sigint"));
