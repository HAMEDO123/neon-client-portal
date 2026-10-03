import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { describeReply, gist, type ActionReply } from "../src/lib/action-reply";
import { uploadFailure } from "../src/lib/upload-limits";

// On 2026-10-03 a 1.5 MB PNG failed from the manager's browser with nothing in
// the server's log, while the same file uploaded fine from a real Chromium on
// the studio's PC. The browser that failed was the only witness, so it now
// says what it got back — and these pin that it says it usefully.

const CLOUDFLARE_413 =
  "<html><head><title>413 Payload Too Large</title></head><body><center><h1>413 Payload Too Large</h1></center><hr><center>cloudflare</center></body></html>";

describe("reading a reply that was not ours", () => {
  it("takes the title of an HTML page", () => {
    assert.equal(gist(CLOUDFLARE_413, "text/html; charset=UTF-8"), "413 Payload Too Large");
  });

  it("falls back to the first heading", () => {
    assert.equal(gist("<html><body><h1> Access   denied </h1></body></html>", "text/html"), "Access denied");
  });

  it("keeps plain text to one short line", () => {
    const long = "Server action not found.\n" + "x".repeat(500);
    const said = gist(long, "text/plain");
    assert.ok(said && said.startsWith("Server action not found."));
    assert.ok(said!.length <= 120);
    assert.doesNotMatch(said!, /\n/);
  });

  it("says nothing for an empty body", () => {
    assert.equal(gist("   ", "text/html"), null);
  });
});

describe("one line to screenshot", () => {
  it("names the status, the type, who answered and what they said", () => {
    const reply: ActionReply = {
      status: 413,
      contentType: "text/html; charset=UTF-8",
      server: "cloudflare",
      ray: "a44d3eb3af9c5409-AMM",
      said: "413 Payload Too Large",
    };
    assert.equal(
      describeReply(reply),
      "HTTP 413 text/html from cloudflare — “413 Payload Too Large” (ray a44d3eb3af9c5409-AMM)."
    );
  });

  it("says when there was no answer at all", () => {
    assert.equal(
      describeReply({ status: 0, contentType: null, server: null, ray: null, said: "Failed to fetch" }),
      "No answer at all (Failed to fetch)."
    );
  });

  it("is null when nothing was watched", () => {
    assert.equal(describeReply(null), null);
  });
});

describe("the failure message, with the reply", () => {
  const file = [{ name: "plan.png", size: 1.5 * 1024 * 1024 }];
  const OPAQUE = "An unexpected response was received from the server.";

  // Ours means the file arrived: saying it "never reached NEON" would send
  // somebody chasing their connection for a refusal the server made.
  it("says the file arrived when the reply was ours", () => {
    const message = uploadFailure(file, "An error occurred in the Server Components render.", {
      status: 500,
      contentType: "text/x-component",
      server: "cloudflare",
      ray: null,
      said: null,
    });
    assert.match(message, /reached NEON and was refused/);
    assert.doesNotMatch(message, /never reached/);
  });

  it("carries what came back when it was somebody else's", () => {
    const message = uploadFailure(file, OPAQUE, {
      status: 403,
      contentType: "text/html",
      server: "cloudflare",
      ray: "abc",
      said: "Attention Required! | Cloudflare",
    });
    assert.match(message, /plan\.png \(1\.5 MB\) never reached NEON/);
    assert.match(message, /HTTP 403 text\/html from cloudflare — “Attention Required! \| Cloudflare”/);
  });

  it("still names the size as the cause when it is", () => {
    const message = uploadFailure([{ name: "big.dwg", size: 120 * 1024 * 1024 }], OPAQUE, {
      status: 413,
      contentType: "text/html",
      server: "cloudflare",
      ray: null,
      said: "413 Payload Too Large",
    });
    assert.match(message, /over the 80 MB limit/);
    assert.match(message, /HTTP 413/);
  });
});
