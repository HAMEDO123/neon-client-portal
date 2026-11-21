// The WhatsApp reply desk inside the platform (asked for on 2026-11-21: "بدي
// اربط هاض البرنامج على تطبيق الشركة … حطه بدل خانة الواتساب القديمه").
//
// The desk is the studio's own program on this PC (C:\Users\USER\whatsapp-claude,
// Node on port 3477): its own linked WhatsApp session, Claude Code for drafts,
// automatic replies, the brief and the appointment book. None of that belongs
// inside a Next.js server, so — exactly like Lead Finder (lead-finder-proxy.ts) —
// it keeps running where it is and the platform serves it at /whatsapp-desk,
// behind the same people who could open the old WhatsApp tab.
//
// Pure, so what crosses the boundary is tested.

/** Where the platform finds the desk: the host, from inside Docker. */
export const WHATSAPP_DESK_URL = process.env.WHATSAPP_DESK_URL ?? "http://host.docker.internal:3477";

/** The path it is served under in the platform. */
export const WHATSAPP_DESK_BASE = "/whatsapp-desk";

/**
 * The headers a request may carry through. An allow-list, like Lead Finder's:
 * the platform's session cookie must not travel to another program.
 */
const REQUEST_HEADERS = ["content-type", "accept", "accept-language"];

/** And the ones a response may carry back (cache-control keeps the live event stream unbuffered). */
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
  // A live event stream must reach the browser as it is written, not when it ends.
  if ((incoming.get("content-type") ?? "").includes("text/event-stream")) out.set("x-accel-buffering", "no");
  return out;
}

/** The address on the desk for a path under /whatsapp-desk. */
export function upstreamUrl(segments: string[], search: string): string {
  const path = segments.map((segment) => encodeURIComponent(segment)).join("/");
  return `${WHATSAPP_DESK_URL}/${path}${search}`;
}

/**
 * Its page asks for "api/…" and "events" relative to itself, and the platform
 * does not keep a trailing slash on /whatsapp-desk — so the page is told where
 * it lives, or "api/chats" would mean the platform's own /api.
 */
export function withBase(html: string): string {
  const tag = `<base href="${WHATSAPP_DESK_BASE}/">`;
  if (html.includes(tag)) return html;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (head) => `${head}${tag}`) : `${tag}${html}`;
}
