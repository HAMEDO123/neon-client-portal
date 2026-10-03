import type { Instrumentation } from "next";

// What the server says when something fails, in words rather than a digest.
//
// Next logs an uncaught error as `⨯ Error: … { digest: '2908028113' }` with a
// minified stack, which says nothing about *where* it happened. Chasing an
// upload that answered "An unexpected response was received from the server"
// cost a whole afternoon partly because the log could not distinguish a page
// render from a server action, or name the route either was on.
//
// `onRequestError` is Next's own hook for this and it carries both: the route
// file, and whether the failure was a render, a route handler or an **action**.
//
// **No headers are logged.** They carry the session cookie and the iOS bearer
// token, and a log is a file that gets copied about. Only the three that say
// what the request *was* — the action id, its size and its type — which are
// the three a failed upload is diagnosed from.

const SAFE_HEADERS = ["next-action", "content-length", "content-type"] as const;

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const said = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String((error as { digest?: unknown }).digest)
      : null;

  const about = SAFE_HEADERS.map((name) => {
    const value = request.headers?.[name];
    const one = Array.isArray(value) ? value[0] : value;
    return one ? `${name}=${one}` : null;
  })
    .filter(Boolean)
    .join(" ");

  console.error(
    `[request-error] ${context.routeType} ${request.method} ${request.path}` +
      ` route=${context.routePath || "?"}` +
      (about ? ` ${about}` : "") +
      ` — ${said}` +
      (digest ? ` (digest ${digest})` : "")
  );
};
