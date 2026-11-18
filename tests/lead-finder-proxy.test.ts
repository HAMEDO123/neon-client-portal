import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  forwardedRequestHeaders,
  forwardedResponseHeaders,
  rewriteLocation,
  upstreamUrl,
  withBase,
  LEAD_FINDER_URL,
} from "../src/lib/lead-finder-proxy";

// Lead Finder served inside the platform, behind the manager's session —
// asked for on 2026-11-18: "فك عنه الsub domain ودخله بالبرنامج تبعنا".

const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), "utf8");

describe("Lead Finder through the platform", () => {
  it("carries no cookie and no Cloudflare header across", () => {
    const out = forwardedRequestHeaders(
      new Headers({
        cookie: "admin_session=secret",
        "cf-connecting-ip": "1.2.3.4",
        "x-forwarded-for": "1.2.3.4",
        "content-type": "application/json",
        accept: "application/json",
      })
    );
    assert.equal(out.get("cookie"), null);
    assert.equal(out.get("cf-connecting-ip"), null);
    assert.equal(out.get("x-forwarded-for"), null);
    assert.equal(out.get("content-type"), "application/json");
  });

  it("lets no cookie of Lead Finder's onto the platform's domain", () => {
    const out = forwardedResponseHeaders(new Headers({ "set-cookie": "lf_auth=x", "content-type": "text/css" }));
    assert.equal(out.get("set-cookie"), null);
    assert.equal(out.get("content-type"), "text/css");
  });

  it("asks Lead Finder for the same path and query", () => {
    assert.equal(upstreamUrl(["api", "leads", "12", "locate"], "?x=1"), `${LEAD_FINDER_URL}/api/leads/12/locate?x=1`);
    assert.equal(upstreamUrl([], ""), `${LEAD_FINDER_URL}/`);
  });

  it("keeps its redirects inside /lead-finder, and tells its pages where they live", () => {
    assert.equal(rewriteLocation("/login"), "/lead-finder/login");
    assert.equal(rewriteLocation("https://example.com/x"), "https://example.com/x");
    assert.equal(
      withBase("<html><head><title>x</title></head></html>"),
      '<html><head><base href="/lead-finder/"><title>x</title></head></html>'
    );
    assert.equal(withBase(withBase("<head></head>")), '<head><base href="/lead-finder/"></head>');
  });

  it("is the manager's alone", () => {
    const route = read("src", "app", "lead-finder", "[[...path]]", "route.ts");
    assert.match(route, /if \(!\(await hasAdminSession\(\)\)\)/);
    const page = read("src", "app", "admin", "(dashboard)", "leads", "page.tsx");
    assert.match(page, /await requireAdminRead\(\)/);
  });
});
