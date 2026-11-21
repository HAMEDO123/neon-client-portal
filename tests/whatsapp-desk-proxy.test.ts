import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  forwardedRequestHeaders,
  forwardedResponseHeaders,
  upstreamUrl,
  withBase,
  WHATSAPP_DESK_URL,
} from "../src/lib/whatsapp-desk-proxy";

// The WhatsApp reply desk served inside the platform, in place of the old
// WhatsApp tab — asked for on 2026-11-21: "حطه بدل خانة الواتساب القديمه".

const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), "utf8");

describe("WhatsApp desk through the platform", () => {
  it("carries no cookie and no Cloudflare header across", () => {
    const out = forwardedRequestHeaders(
      new Headers({ cookie: "admin_session=x", "cf-connecting-ip": "1.2.3.4", "content-type": "application/json", accept: "text/event-stream" })
    );
    assert.equal(out.get("cookie"), null);
    assert.equal(out.get("cf-connecting-ip"), null);
    assert.equal(out.get("content-type"), "application/json");
    assert.equal(out.get("accept"), "text/event-stream");
  });

  it("brings no cookie back, and keeps a live event stream unbuffered", () => {
    const out = forwardedResponseHeaders(new Headers({ "set-cookie": "a=b", "content-type": "text/event-stream", "cache-control": "no-cache" }));
    assert.equal(out.get("set-cookie"), null);
    assert.equal(out.get("cache-control"), "no-cache");
    assert.equal(out.get("x-accel-buffering"), "no");
    assert.equal(forwardedResponseHeaders(new Headers({ "content-type": "application/json" })).get("x-accel-buffering"), null);
  });

  it("asks the desk on the host for the same path", () => {
    assert.equal(upstreamUrl(["api", "chats", "123@lid"], "?x=1"), `${WHATSAPP_DESK_URL}/api/chats/123%40lid?x=1`);
    assert.equal(upstreamUrl([], ""), `${WHATSAPP_DESK_URL}/`);
  });

  it("tells the page where it lives, once", () => {
    const html = withBase("<html><head><title>x</title></head></html>");
    assert.match(html, /<head><base href="\/whatsapp-desk\/">/);
    assert.equal(withBase(html), html);
  });

  it("lets in exactly the people of the old WhatsApp tab", () => {
    const route = read("src/app/whatsapp-desk/[[...path]]/route.ts");
    assert.match(route, /hasAdminSession\(\)/);
    assert.match(route, /canReadWhatsApp/);
    for (const page of ["src/app/admin/(dashboard)/whatsapp/page.tsx", "src/app/employee/(portal)/whatsapp/page.tsx"]) {
      const body = read(page);
      assert.match(body, /requireWhatsAppAccess\(\)/, page);
      assert.match(body, /src="\/whatsapp-desk"/, page);
    }
  });
});
