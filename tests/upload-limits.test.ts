import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BODY_LIMIT_BYTES,
  CLOUDFLARE_LIMIT_BYTES,
  MAX_UPLOAD_BYTES,
  isOpaqueFailure,
  sizeLabel,
  tooBig,
  uploadFailure,
} from "../src/lib/upload-limits";

// A file past either ceiling does not fail with a message — it dies between
// Cloudflare and the app and the browser reports a reply it cannot read. These
// numbers are the only thing standing between somebody and that.

const MB = 1024 * 1024;
const file = (name: string, mb: number) =>
  ({ name, size: Math.round(mb * MB) }) as File;

describe("the two ceilings", () => {
  it("keeps the offered limit under both of them", () => {
    // Measured on 2026-10-03: 95 MB reached the tunnel, 100 MB came back 413
    // from Cloudflare. Raising MAX_UPLOAD_BYTES past either only moves the
    // failure to a place with no message.
    assert.ok(MAX_UPLOAD_BYTES < BODY_LIMIT_BYTES, "under Next's body limit");
    assert.ok(MAX_UPLOAD_BYTES < CLOUDFLARE_LIMIT_BYTES, "under Cloudflare's");
  });

  it("leaves room for what multipart wraps round the file", () => {
    // Boundaries, part headers and the other fields ride in the same body.
    assert.ok(BODY_LIMIT_BYTES - MAX_UPLOAD_BYTES >= 5 * MB);
  });
});

describe("what somebody is told", () => {
  it("says nothing about a file that fits", () => {
    assert.equal(tooBig([file("plan.dwg", 40)]), null);
    assert.equal(tooBig([]), null);
  });

  it("names the file and both figures, so the next try is informed", () => {
    const said = tooBig([file("plan.dwg", 140)]);
    assert.match(said ?? "", /plan\.dwg/);
    assert.match(said ?? "", /140 MB/);
    assert.match(said ?? "", /80 MB/);
  });

  it("catches the one that is too big among several", () => {
    const said = tooBig([file("small.pdf", 1), file("huge.dwg", 120), file("ok.pdf", 2)]);
    assert.match(said ?? "", /huge\.dwg/);
  });

  it("catches several that only break it together, and says what to do", () => {
    // The gallery's own uploader posts one file per request, but a form that
    // sends them in one body is limited by the whole of it.
    const said = tooBig([file("a.jpg", 50), file("b.jpg", 50)]);
    assert.match(said ?? "", /together/);
    assert.match(said ?? "", /a few at a time/);
  });

  it("does not complain about a single file that fits, however near the line", () => {
    assert.equal(tooBig([file("edge.pdf", 79.9)]), null);
  });
});

describe("how a size is written", () => {
  it("is a sentence's worth of precision, not a table's", () => {
    assert.equal(sizeLabel(80 * MB), "80 MB");
    assert.equal(sizeLabel(2.44 * MB), "2.4 MB");
    assert.equal(sizeLabel(640 * 1024), "640 KB");
  });

  it("never says 0 KB for a file that exists", () => {
    // "that file is 0 KB" about something plainly there reads as a bug.
    assert.equal(sizeLabel(12), "1 KB");
  });
});

describe("the failures that say nothing", () => {
  // Measured against the live site on 2026-10-03: a 105 MB upload came back
  // `413 Payload Too Large` as an HTML page from Cloudflare, which React
  // reports with this sentence and which leaves no trace in the server's log.
  const CLOUDFLARE = "An unexpected response was received from the server.";

  // What Next hands the browser instead of a thrown message in production.
  const REDACTED =
    "An error occurred in the Server Components render. The specific message is " +
    "omitted in production builds to avoid leaking sensitive details.";

  it("knows which messages tell the reader nothing", () => {
    assert.equal(isOpaqueFailure(CLOUDFLARE), true);
    assert.equal(isOpaqueFailure(REDACTED), true);
    assert.equal(isOpaqueFailure("Failed to fetch"), true);
  });

  // An unknown action is answered `text/plain` with this, which React shows
  // verbatim. It means a page from another build, not a file that was refused,
  // and the two must not be given the same sentence.
  it("leaves a message that does say something alone", () => {
    assert.equal(isOpaqueFailure("Server action not found."), false);
    assert.equal(
      uploadFailure([{ name: "a.pdf", size: 10 }], "Server action not found."),
      "Server action not found."
    );
    assert.equal(uploadFailure([], "Select a file to upload."), "Select a file to upload.");
  });

  it("names the file and its size when the failure does not", () => {
    const message = uploadFailure([{ name: "plan.dwg", size: 120 * 1024 * 1024 }], CLOUDFLARE);
    assert.match(message, /plan\.dwg/);
    assert.match(message, /120 MB/);
    // Over the limit is a cause we know, so it is stated rather than guessed at.
    assert.match(message, /over the 80 MB limit/);
  });

  it("asks for a reload when the size was not the problem", () => {
    const message = uploadFailure([{ name: "plan.dwg", size: 2 * 1024 * 1024 }], REDACTED);
    assert.match(message, /plan\.dwg/);
    assert.match(message, /Reload the page/);
    assert.doesNotMatch(message, /over the/);
  });

  it("counts several files together", () => {
    const message = uploadFailure(
      [
        { name: "a.jpg", size: 50 * 1024 * 1024 },
        { name: "b.jpg", size: 50 * 1024 * 1024 },
      ],
      CLOUDFLARE
    );
    assert.match(message, /Those 2 files \(100 MB together\)/);
  });

  // A file picker that was never filled in posts a zero-byte entry; naming it
  // would read as though the upload had carried something.
  it("ignores empty entries", () => {
    const message = uploadFailure([{ name: "", size: 0 }], CLOUDFLARE);
    assert.match(message, /^That upload never reached NEON/);
  });
});
