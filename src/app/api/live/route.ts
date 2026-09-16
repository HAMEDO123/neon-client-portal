import { getChatViewer } from "@/lib/chat";
import { liveSignature } from "@/lib/realtime";
import { appVersion } from "@/lib/app-version";
import { HEARTBEAT_MS } from "@/lib/presence";
import { beat, memberKeyFor, onlineNow } from "@/lib/presence-store";

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
//
// This connection is also what presence means. Holding it open is the whole
// definition of being here, so the server writes a heartbeat for whoever opened
// it — every HEARTBEAT_MS rather than on every poll, because being here does
// not change thirty times a minute.
//
// Presence travels as its own `people` event and is deliberately kept OUT of
// liveSignature(): that signature is what makes every open page re-render, and
// a heartbeat inside it would redraw the whole platform for everybody, for
// every person, every few seconds.

export const dynamic = "force-dynamic";
export const revalidate = 0;

const POLL_MS = 2000;
const MAX_LIFETIME_MS = 4 * 60_000;
// Beat on this many polls, so the write rate is HEARTBEAT_MS however often the
// signature is checked.
const POLLS_PER_BEAT = Math.max(1, Math.round(HEARTBEAT_MS / POLL_MS));

export async function GET(request: Request) {
  // Presence needs to know who, not merely whether — and the identity comes
  // from the session cookie, never from the request.
  const viewer = await getChatViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });
  const me = memberKeyFor(viewer);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      // Seeded with the signature at connection time, so a client that has
      // just rendered the page is not told to render it again.
      let last = await liveSignature().catch(() => "");
      // Empty, so the first look always sends who is here.
      let peopleSeen = "";
      let polls = 0;

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

      /** Who is here, sent only when the set or their times actually move. */
      const syncPeople = async () => {
        const rows = await onlineNow();
        const signature = rows.map((row) => `${row.memberKey}:${row.lastSeenAt.getTime()}`).join(",");
        if (signature === peopleSeen) return;
        peopleSeen = signature;
        send("people", { online: rows.map((row) => ({ key: row.memberKey, at: row.lastSeenAt.toISOString() })) });
      };

      // Opening the page is being here.
      await beat(me).catch(() => undefined);

      // The build this server is running, so a page drawn by the one before it
      // knows to reload rather than talk to a server that is gone.
      send("ready", { sig: last, version: appVersion() });
      await syncPeople().catch(() => undefined);

      const timer = setInterval(async () => {
        if (closed) return;
        try {
          polls += 1;
          if (polls % POLLS_PER_BEAT === 0) await beat(me);

          const sig = await liveSignature();
          if (sig !== last) {
            last = sig;
            send("changed", { sig });
          } else {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          }

          await syncPeople();
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
