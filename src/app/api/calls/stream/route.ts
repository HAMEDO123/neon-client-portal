import { chatSide, getChatViewer } from "@/lib/chat";
import { callsFor, latestSignalId, signalsFor, sweepStale } from "@/lib/call-store";
import { memberKeyOf } from "@/lib/calls";
import { iceServers, turnConfigured } from "@/lib/ice-servers";

// Calls, live, for whoever is signed in — open in every screen of both
// portals, so a call can ring anywhere in the app.
//
// Three kinds of news: `ready` (who you are to calls, and the servers your
// device should use to connect), `calls` (every call ringing or running in a
// conversation you are in, sent again whenever anything about them changes)
// and `signals` (what the other devices in your call sent yours). Signals
// carry their id as the event id, so a reconnecting browser — which sends the
// last one it saw — misses none and repeats none.
//
// It looks often while you are in a call or being rung, and at a walk
// otherwise. Every few seconds it also tidies calls that rang out or lost
// somebody, so a closed tab never leaves a call ringing for ever.

export const dynamic = "force-dynamic";
export const revalidate = 0;

const BUSY_MS = 700;
const IDLE_MS = 2500;
const SWEEP_MS = 5000;
// Proxies close idle connections after a while; ending it ourselves first
// means the browser reconnects cleanly instead of seeing a broken pipe.
const MAX_LIFETIME_MS = 4 * 60_000;

export async function GET(request: Request) {
  const viewer = await getChatViewer(chatSide(new URL(request.url).searchParams.get("as")));
  if (!viewer) return new Response("Unauthorized", { status: 401 });

  const me = memberKeyOf(viewer);
  const resumed = Number(request.headers.get("last-event-id"));
  let cursor = Number.isInteger(resumed) && resumed > 0 ? resumed : await latestSignalId();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let seenCalls = "";
      let lastSweep = 0;
      const clocks: { next?: ReturnType<typeof setTimeout>; lifetime?: ReturnType<typeof setTimeout> } = {};

      const write = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(text));
      };
      const send = (event: string, data: unknown, id?: number) =>
        write(`${id != null ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      const finish = () => {
        if (closed) return;
        closed = true;
        clearTimeout(clocks.next);
        clearTimeout(clocks.lifetime);
        try {
          controller.close();
        } catch {
          // Already closed by the client going away.
        }
      };
      request.signal.addEventListener("abort", finish);

      // A dropped connection comes back after two seconds rather than at once.
      write("retry: 2000\n\n");
      send("ready", { me, name: viewer.name, iceServers: await iceServers(), relay: turnConfigured() });

      const look = async () => {
        if (closed) return;
        let busy = false;
        try {
          const now = Date.now();
          if (now - lastSweep > SWEEP_MS) {
            lastSweep = now;
            await sweepStale(now);
          }

          const calls = await callsFor(viewer);
          const snapshot = JSON.stringify(calls);
          const changed = snapshot !== seenCalls;
          if (changed) {
            seenCalls = snapshot;
            send("calls", calls);
          }

          const signals = await signalsFor(me, cursor);
          if (signals.length > 0) {
            cursor = signals[signals.length - 1].id;
            send("signals", signals, cursor);
          }

          if (!changed && signals.length === 0) write(": keep-alive\n\n");

          busy = calls.some((call) =>
            call.participants.some((part) => part.memberKey === me && (part.state === "JOINED" || part.state === "INVITED"))
          );
        } catch {
          // A database hiccup drops the stream; the browser reconnects and
          // picks up from the last signal it saw.
          finish();
          return;
        }
        clocks.next = setTimeout(look, busy ? BUSY_MS : IDLE_MS);
      };

      clocks.lifetime = setTimeout(finish, MAX_LIFETIME_MS);
      await look();
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
