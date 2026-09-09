import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { getSessionEmployee } from "@/lib/employee-session";
import { liveSignature } from "@/lib/realtime";

// The platform's heartbeat.
//
// One open connection per signed-in person. Every couple of seconds the server
// asks the database for the signature of everything worth watching and, when
// it differs from what this connection last sent, says so. The page then
// re-renders itself from the server, which is what makes a status an employee
// changes on their phone appear on the manager's board without a reload.
//
// Same shape as the chat stream: SSE, a bounded lifetime so the proxy never
// cuts a connection mid-flight, and no payload beyond the signature — a client
// learns that something changed, never what.

export const dynamic = "force-dynamic";
export const revalidate = 0;

const POLL_MS = 2000;
const MAX_LIFETIME_MS = 4 * 60_000;

async function isSignedIn() {
  const store = await cookies();
  if (verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) return true;
  return Boolean(await getSessionEmployee());
}

export async function GET(request: Request) {
  if (!(await isSignedIn())) return new Response("Unauthorized", { status: 401 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      // Seeded with the signature at connection time, so a client that has
      // just rendered the page is not told to render it again.
      let last = await liveSignature().catch(() => "");

      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        clearTimeout(lifetime);
        try {
          controller.close();
        } catch {
          // Already gone.
        }
      };

      send("ready", { sig: last });

      const timer = setInterval(async () => {
        if (closed) return;
        try {
          const sig = await liveSignature();
          if (sig !== last) {
            last = sig;
            send("changed", { sig });
          } else {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          }
        } catch {
          // Drop the stream rather than crash the route; the browser
          // reconnects on its own.
          finish();
        }
      }, POLL_MS);

      const lifetime = setTimeout(finish, MAX_LIFETIME_MS);
      request.signal.addEventListener("abort", finish);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
