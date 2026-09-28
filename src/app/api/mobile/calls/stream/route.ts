import { callsFor, latestSignalId, signalsFor, sweepStale } from "@/lib/call-store";
import { memberKeyOf } from "@/lib/calls";
import { iceServers, turnConfigured } from "@/lib/ice-servers";
import { mobileViewer } from "@/lib/mobile-auth";

// Calls, live, for the phone — the same stream as src/app/api/calls/stream/route.ts
// (see it for the shape of the three events and why they exist), with the
// viewer read from the app's bearer token instead of a cookie. Reuses
// callsFor/signalsFor/sweepStale rather than copying their logic.
//
// Resumable with Last-Event-ID exactly like the web: a reconnecting client
// sends the last signal id it saw and misses nothing sent while it was gone.

export const dynamic = "force-dynamic";
export const revalidate = 0;

const BUSY_MS = 700;
const IDLE_MS = 2500;
const SWEEP_MS = 5000;
// A cellular connection drops an idle stream more readily than a browser tab;
// ending it ourselves first means the app reconnects cleanly with the last
// signal id it saw, rather than seeing a broken pipe.
const MAX_LIFETIME_MS = 4 * 60_000;

export async function GET(request: Request) {
  const viewer = await mobileViewer(request);
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
          // A database hiccup drops the stream; the app reconnects and picks
          // up from the last signal it saw.
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
