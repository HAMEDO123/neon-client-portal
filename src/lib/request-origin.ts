// Whether a request that changes something came from this site's own pages.
//
// Server actions check this for themselves. A route handler that acts on the
// session cookie does not, so without it any other website could make a
// signed-in browser start a call, or leave one. Browsers send Origin with
// every POST — fetch and sendBeacon alike — and the site's own host arrives as
// Host, or as X-Forwarded-Host behind a proxy or the tunnel.

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";

  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwarded || request.headers.get("host");
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
