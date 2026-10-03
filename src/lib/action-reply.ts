// What actually came back when a server action failed in the browser.
//
// A failed upload reaches the page as one of two sentences that name nothing —
// "An unexpected response was received from the server", or Next's paragraph
// about details omitted in production — and when the reply was not ours at all
// (Cloudflare, a proxy, something on the person's own machine), the server's
// log is empty too. On 2026-10-03 a 1.5 MB PNG failed that way from the
// manager's browser while the same file, posted by a real Chromium from the
// studio's PC, uploaded perfectly: the one place the answer existed was the
// browser that failed, and nothing there was keeping it.
//
// So while an upload runs, the browser notes the reply to its server-action
// request — status, type, who answered, the page's title — and the failure
// message carries that line. Nothing else is read: never a header that holds a
// session, never a body that is ours (an RSC reply is not opened at all).

export type ActionReply = {
  /** 0 when the request never got an answer. */
  status: number;
  contentType: string | null;
  /** The `server` header — "cloudflare" says who stopped it. */
  server: string | null;
  /** Cloudflare's request id, for its own dashboard. */
  ray: string | null;
  /** The <title> of an HTML reply, or the first words of a text one, or the network error. */
  said: string | null;
};

const RSC = "text/x-component";

/** The <title> of an HTML page, or the start of a plain one — never more than a line. */
export function gist(body: string, contentType: string | null): string | null {
  const text = body.trim();
  if (!text) return null;
  if ((contentType ?? "").includes("html")) {
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1];
    const heading = /<h1[^>]*>([^<]*)<\/h1>/i.exec(text)?.[1];
    const found = (title || heading || "").replace(/\s+/g, " ").trim();
    return found ? found.slice(0, 120) : null;
  }
  return text.replace(/\s+/g, " ").slice(0, 120);
}

/** One line for a person to screenshot and for the log to keep. */
export function describeReply(reply: ActionReply | null): string | null {
  if (!reply) return null;
  if (reply.status === 0) return `No answer at all${reply.said ? ` (${reply.said})` : ""}.`;

  const parts = [`HTTP ${reply.status}`];
  if (reply.contentType) parts.push(reply.contentType.split(";")[0]);
  if (reply.server) parts.push(`from ${reply.server}`);
  let line = parts.join(" ");
  if (reply.said) line += ` — “${reply.said}”`;
  if (reply.ray) line += ` (ray ${reply.ray})`;
  return `${line}.`;
}

// ---------------------------------------------------------------------------
// The browser half. Installed only while an upload is in flight, counted so two
// at once share one wrapper, and always removed — a fetch left patched for the
// life of the page would be a thing nobody remembers is there.

let depth = 0;
let original: typeof fetch | null = null;
let last: ActionReply | null = null;

function isAction(init: RequestInit | undefined): boolean {
  try {
    return new Headers(init?.headers).has("next-action");
  } catch {
    return false;
  }
}

function install() {
  if (depth++ > 0) return;
  original = window.fetch;
  const real = original;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isAction(init)) return real(input, init);
    try {
      const response = await real(input, init);
      const contentType = response.headers.get("content-type");
      let said: string | null = null;
      // Ours is streamed and is the page itself; only a stranger's reply is read.
      if (!(contentType ?? "").startsWith(RSC)) {
        said = gist(await response.clone().text().catch(() => ""), contentType);
      }
      last = {
        status: response.status,
        contentType,
        server: response.headers.get("server"),
        ray: response.headers.get("cf-ray"),
        said,
      };
      return response;
    } catch (error) {
      last = { status: 0, contentType: null, server: null, ray: null, said: error instanceof Error ? error.message : String(error) };
      throw error;
    }
  };
}

function uninstall() {
  if (--depth > 0) return;
  if (original) window.fetch = original;
  original = null;
}

/** Run an upload with its reply noted; the reply is null when nothing was sent. */
export async function watchingReply<T>(run: () => Promise<T>): Promise<T> {
  last = null;
  install();
  try {
    return await run();
  } finally {
    uninstall();
  }
}

/** The reply the last watched upload got. */
export function lastReply(): ActionReply | null {
  return last;
}

/**
 * Tell the server what the browser saw. A beacon, so it goes even if the page
 * is about to be left, and its failure is nobody's problem: it is evidence, not
 * part of the upload.
 */
export function reportUploadFailure(details: {
  where: string;
  files: { name: string; size: number; type: string }[];
  message: string;
  reply: ActionReply | null;
}) {
  try {
    const body = JSON.stringify({ ...details, page: window.location.pathname, agent: navigator.userAgent });
    navigator.sendBeacon?.("/api/diagnostics/upload", new Blob([body], { type: "application/json" }));
  } catch {
    // Evidence that could not be sent is still on the screen.
  }
}
