import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AttachmentCache, attachmentName, contentDisposition, readRange } from "../src/lib/whatsapp-media";

// Handing a WhatsApp attachment over. Each rule here fails without a word when
// it is wrong: a file nothing will open, a voice note Safari refuses to play,
// a photo that stays a grey box.

describe("a name the system can open the file by", () => {
  // WhatsApp names a document and nothing else. The phone app saves what it
  // downloads under the name it is given, and "attachment" opens in nothing.
  it("is made from what the file is when WhatsApp gave none", () => {
    assert.equal(attachmentName("image/jpeg", null), "photo.jpg");
    assert.equal(attachmentName("video/mp4", ""), "video.mp4");
    assert.equal(attachmentName("audio/mp4", null), "voice-note.m4a");
    assert.equal(attachmentName("audio/ogg; codecs=opus", null), "voice-note.ogg");
    assert.equal(attachmentName("application/pdf", null), "attachment.pdf");
  });

  it("keeps the sender's own name when it already says what it is", () => {
    assert.equal(attachmentName("application/pdf", "lastoria.pdf"), "lastoria.pdf");
    assert.equal(attachmentName("application/octet-stream", "مخطط الطابق.dwg"), "مخطط الطابق.dwg");
  });

  it("finishes a name that has no extension", () => {
    assert.equal(attachmentName("application/pdf", "عرض السعر"), "عرض السعر.pdf");
  });

  it("does not invent an extension for a type it does not know", () => {
    assert.equal(attachmentName("application/x-something", null), "attachment");
  });
});

describe("the header a name travels in", () => {
  // A raw Arabic name is not a valid header value: building the response
  // throws, and the file is a 500 instead of a file.
  it("carries an Arabic name without putting it in the plain part", () => {
    const header = contentDisposition("عرض السعر.pdf");
    assert.ok(/^[\x20-\x7E]*$/.test(header), "the header must be plain ASCII");
    assert.ok(header.includes(`filename*=UTF-8''${encodeURIComponent("عرض السعر.pdf")}`));
    assert.doesNotThrow(() => new Headers({ "content-disposition": header }));
  });

  it("cannot be broken out of by a quote in the name", () => {
    assert.ok(contentDisposition('a"b.pdf').startsWith('inline; filename="ab.pdf"'));
  });
});

describe("the part of a file a player asks for", () => {
  // Safari asks for the first two bytes before it will play anything. The
  // whole file with a 200 is read as "this cannot be played".
  it("reads Safari's first question", () => {
    assert.deepEqual(readRange("bytes=0-1", 1000), { start: 0, end: 1 });
  });

  it("reads an open end, a closed one, and the last so many", () => {
    assert.deepEqual(readRange("bytes=100-", 1000), { start: 100, end: 999 });
    assert.deepEqual(readRange("bytes=100-199", 1000), { start: 100, end: 199 });
    assert.deepEqual(readRange("bytes=-200", 1000), { start: 800, end: 999 });
  });

  it("stops at the end of the file", () => {
    assert.deepEqual(readRange("bytes=900-5000", 1000), { start: 900, end: 999 });
    assert.deepEqual(readRange("bytes=-5000", 1000), { start: 0, end: 999 });
  });

  it("says so when the range starts past the end", () => {
    assert.equal(readRange("bytes=1000-", 1000), "unsatisfiable");
    assert.equal(readRange("bytes=-0", 1000), "unsatisfiable");
  });

  // A header that cannot be read is ignored, as the standard says — the whole
  // file is a correct answer to it, and a refusal is not.
  it("hands over the whole file for anything it cannot read", () => {
    for (const header of [null, "", "bytes=", "bytes=-", "items=0-1", "bytes=0-1,5-9", "bytes=9-3", "bytes=a-b"]) {
      assert.equal(readRange(header, 1000), null, String(header));
    }
  });
});

describe("the few minutes a fetched attachment is kept", () => {
  const file = (size: number) => ({ bytes: new Uint8Array(size) });

  it("hands back what it was given, until the time is up", () => {
    const cache = new AttachmentCache<{ bytes: Uint8Array }>(1000, 100, 50);
    const photo = file(10);
    cache.set("a", photo, 0);
    assert.equal(cache.get("a", 999), photo);
    // These are somebody's private messages: past the time, it is gone.
    assert.equal(cache.get("a", 1001), null);
    assert.equal(cache.bytes, 0);
  });

  it("lets go of the oldest when it is full", () => {
    const cache = new AttachmentCache<{ bytes: Uint8Array }>(1000, 100, 50);
    cache.set("a", file(40), 0);
    cache.set("b", file(40), 1);
    cache.set("c", file(40), 2);
    assert.equal(cache.get("a", 3), null);
    assert.ok(cache.get("b", 3));
    assert.ok(cache.get("c", 3));
    assert.equal(cache.bytes, 80);
  });

  // One long video must not push every photo out, and must not be held either.
  it("does not keep a file that is too large, and loses nothing for it", () => {
    const cache = new AttachmentCache<{ bytes: Uint8Array }>(1000, 100, 50);
    cache.set("a", file(10), 0);
    cache.set("video", file(60), 1);
    assert.equal(cache.get("video", 2), null);
    assert.ok(cache.get("a", 2));
  });

  it("counts a file once when it is put back", () => {
    const cache = new AttachmentCache<{ bytes: Uint8Array }>(1000, 100, 50);
    cache.set("a", file(30), 0);
    cache.set("a", file(30), 1);
    assert.equal(cache.bytes, 30);
  });
});

// The fault this file exists because of. WhatsApp Web began refusing a download
// that names no mimetype for everything but a document — photos, voice notes,
// videos and stickers all stopped opening, and the only trace was the single
// letter "t" in the worker's log. Nothing in this repository runs that code
// against a real account, so what can be pinned is that the worker still sends
// it, and that both routes go through the one place that makes a file playable.
describe("what keeps attachments opening", () => {
  const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");

  it("the worker hands WhatsApp the message's own mimetype", () => {
    const worker = read("whatsapp-worker", "server.mjs");
    const call = worker.slice(worker.indexOf("downloadAndMaybeDecrypt({"));
    assert.match(call.slice(0, call.indexOf("});")), /mimetype: msg\.mimetype/);
  });

  it("a failure in the page comes back as words, not as a thrown minified error", () => {
    assert.match(read("whatsapp-worker", "server.mjs"), /unavailable: /);
  });

  it("both media routes hand over the same thing", () => {
    for (const route of [
      ["src", "app", "api", "whatsapp", "media", "[messageId]", "route.ts"],
      ["src", "app", "api", "mobile", "whatsapp", "media", "[messageId]", "route.ts"],
    ]) {
      const source = read(...route);
      assert.match(source, /readAttachment\(messageId\)/, route.join("/"));
      assert.match(source, /attachmentResponse\(request, result\.data\)/, route.join("/"));
      // The guard runs before anything is looked up — the short keep is ours,
      // and must never be reachable by somebody who was not checked.
      assert.ok(source.indexOf("requireWhatsAppAccess()") < source.indexOf("readAttachment(messageId)"), route.join("/"));
    }
  });
});
