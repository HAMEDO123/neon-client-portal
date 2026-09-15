import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sameOrigin } from "../src/lib/request-origin";

const post = (headers: Record<string, string>) =>
  new Request("http://localhost:3010/api/calls", { method: "POST", headers });

describe("a request from the site's own pages", () => {
  it("is accepted when its origin is the host it was sent to", () => {
    assert.equal(sameOrigin(post({ origin: "http://localhost:3010", host: "localhost:3010" })), true);
  });

  it("is judged by the forwarded host behind the tunnel or a proxy", () => {
    assert.equal(
      sameOrigin(post({ origin: "https://clients.neonjo.com", host: "neon-app:3000", "x-forwarded-host": "clients.neonjo.com" })),
      true
    );
  });

  it("refuses another website, a malformed origin, and a request with no origin that is not same-site", () => {
    assert.equal(sameOrigin(post({ origin: "https://evil.example", host: "localhost:3010" })), false);
    assert.equal(sameOrigin(post({ origin: "not a url", host: "localhost:3010" })), false);
    assert.equal(sameOrigin(post({ host: "localhost:3010" })), false);
    assert.equal(sameOrigin(post({ host: "localhost:3010", "sec-fetch-site": "same-origin" })), true);
  });
});
