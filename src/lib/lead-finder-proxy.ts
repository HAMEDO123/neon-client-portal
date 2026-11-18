// Lead Finder inside the platform (asked for on 2026-11-18: "فك عنه الsub
// domain ودخله بالبرنامج تبعنا").
//
// Lead Finder is the studio's own client finder — a Python app on this PC
// (C:\Users\USER\lead-finder, port 8733) with browser automation, OCR and a
// SQLite database, none of which belongs inside a Next.js server. So it keeps
// running where it is, and the platform serves it at /lead-finder behind the
// manager's own session: no subdomain, no second password.
//
// Pure, so what crosses the boundary is tested.

/** Where the platform finds Lead Finder: the host, from inside Docker. */
export const LEAD_FINDER_URL = process.env.LEAD_FINDER_URL ?? "http://host.docker.internal:8733";

/** The path it is served under in the platform. */
export const LEAD_FINDER_BASE = "/lead-finder";

/**
 * The headers a request may carry through to Lead Finder.
 *
 * An allow-list, deliberately: the manager's session cookie must not travel to
 * another program, and Cloudflare's own headers (`cf-connecting-ip` and the
 * rest) are what Lead Finder reads to decide a request came from the internet
 * and must log in with its old password.
 */
const REQUEST_HEADERS = ["content-type", "accept", "accept-language"];

/** And the ones a response may carry back. */
const RESPONSE_HEADERS = ["content-type", "content-disposition", "cache-control", "last-modified", "etag"];

export function forwardedRequestHeaders(incoming: Headers): Headers {
  const out = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = incoming.get(name);
    if (value) out.set(name, value);
  }
  return out;
}

export function forwardedResponseHeaders(incoming: Headers): Headers {
  const out = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = incoming.get(name);
    if (value) out.set(name, value);
  }
  return out;
}

/** The address on Lead Finder for a path under /lead-finder. */
export function upstreamUrl(segments: string[], search: string): string {
  const path = segments.map((segment) => encodeURIComponent(segment)).join("/");
  return `${LEAD_FINDER_URL}/${path}${search}`;
}

/** A redirect Lead Finder sends ("/login") is a place under /lead-finder here. */
export function rewriteLocation(location: string | null): string | null {
  if (!location) return null;
  if (location.startsWith("/")) return `${LEAD_FINDER_BASE}${location}`;
  return location;
}

/**
 * Its pages ask for "static/app.js" and "api/…" relative to themselves, and the
 * platform does not keep a trailing slash on /lead-finder — so the page is told
 * where it lives, or "static/app.js" would mean the platform's own /static.
 */
export function withBase(html: string): string {
  const tag = `<base href="${LEAD_FINDER_BASE}/">`;
  if (html.includes(tag)) return html;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (head) => `${head}${tag}`) : `${tag}${html}`;
}
