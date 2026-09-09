import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { normalisePhone } from "@/lib/whatsapp/worker";

// Verified against a stub that speaks the real worker's protocol: the
// x-worker-key header, the /lines/:line/... paths, 204 on a successful send,
// and the worker's own error text passed back verbatim.

const WORKER_KEY = "test-worker-key";

type Seen = { path: string; method: string; key: string | undefined; body: unknown };

let server: Server;
let port = 0;
const seen: Seen[] = [];
let nextFailure: { status: number; error: string } | null = null;

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const path = req.url ?? "";
      const key = req.headers["x-worker-key"] as string | undefined;
      seen.push({ path, method: req.method ?? "", key, body: raw ? JSON.parse(raw) : null });

      if (path === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: true, companyId: "neon" }));
      }

      // Everything else needs the shared key, exactly as the worker does.
      if (key !== WORKER_KEY) {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "unauthorized" }));
      }

      if (nextFailure) {
        const failure = nextFailure;
        nextFailure = null;
        res.writeHead(failure.status, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: failure.error }));
      }

      if (path.endsWith("/check-number")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ reachable: true }));
      }

      res.writeHead(204);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  port = typeof address === "object" && address ? address.port : 0;

  process.env.WHATSAPP_WORKER_URL = `http://127.0.0.1:${port}`;
  process.env.WHATSAPP_WORKER_KEY = WORKER_KEY;
  process.env.WHATSAPP_LINE_ID = "main";
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Imported per test so each one reads the environment set in `before`. */
async function worker() {
  return import("@/lib/whatsapp/worker");
}

describe("phone numbers", () => {
  it("reduces a written number to digits", () => {
    assert.equal(normalisePhone("+962 79 000 0000"), "962790000000");
  });

  it("rejects something too short to be a number", () => {
    assert.equal(normalisePhone("123"), null);
    assert.equal(normalisePhone(null), null);
  });
});

describe("worker client", () => {
  it("reports the worker as configured and healthy", async () => {
    const { isWhatsAppConfigured, whatsAppHealth } = await worker();
    assert.equal(isWhatsAppConfigured(), true);

    const health = await whatsAppHealth();
    assert.equal(health.ok, true);
    assert.equal(health.ok && health.data.companyId, "neon");
  });

  it("sends text to the configured line with the shared key", async () => {
    const { sendWhatsAppText } = await worker();
    seen.length = 0;

    const result = await sendWhatsAppText("+962 79 123 4567", "Hello from NEON");
    assert.equal(result.ok, true);

    const request = seen.at(-1)!;
    assert.equal(request.path, "/lines/main/send-text");
    assert.equal(request.method, "POST");
    assert.equal(request.key, WORKER_KEY);
    // The number reaches the worker as digits, as WhatsApp expects.
    assert.deepEqual(request.body, { phone: "962791234567", text: "Hello from NEON" });
  });

  it("refuses to send to an unusable number without calling the worker", async () => {
    const { sendWhatsAppText } = await worker();
    seen.length = 0;

    const result = await sendWhatsAppText("12", "Hello");
    assert.equal(result.ok, false);
    assert.equal(seen.length, 0, "nothing should have been sent");
  });

  it("passes the worker's own error text back", async () => {
    const { sendWhatsAppText } = await worker();
    // The worker returns its message verbatim; that detail is what tells the
    // manager whether the line is unlinked or the number is unreachable.
    nextFailure = { status: 500, error: "No LID for user" };

    const result = await sendWhatsAppText("962791234567", "Hello");
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.error, "No LID for user");
  });

  it("checks whether a number is on WhatsApp", async () => {
    const { checkWhatsAppNumber } = await worker();
    const result = await checkWhatsAppNumber("962791234567");
    assert.equal(result.ok && result.data.reachable, true);
  });

  it("sends media as base64 on the media route", async () => {
    const { sendWhatsAppMedia } = await worker();
    seen.length = 0;

    const result = await sendWhatsAppMedia("962791234567", {
      base64: "aGVsbG8=",
      mimeType: "application/pdf",
      filename: "gallery.pdf",
      asDocument: true,
    });

    assert.equal(result.ok, true);
    const request = seen.at(-1)!;
    assert.equal(request.path, "/lines/main/send-media");
    assert.deepEqual(request.body, {
      phone: "962791234567",
      fileBase64: "aGVsbG8=",
      mimeType: "application/pdf",
      filename: "gallery.pdf",
      asDocument: true,
    });
  });

  it("reports a rejected key rather than pretending it sent", async () => {
    process.env.WHATSAPP_WORKER_KEY = "wrong-key";
    const { sendWhatsAppText } = await worker();

    const result = await sendWhatsAppText("962791234567", "Hello");
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.status, 401);

    process.env.WHATSAPP_WORKER_KEY = WORKER_KEY;
  });
});
