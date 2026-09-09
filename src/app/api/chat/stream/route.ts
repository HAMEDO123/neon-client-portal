import { prisma } from "@/lib/db";
import { getChatViewer, getTeamChannel, type ChatViewer } from "@/lib/chat";

// Live chat, over Server-Sent Events.
//
// The browser holds this connection open and the server writes to it as
// messages arrive, so a message someone else sends appears without anyone
// reloading. SSE rather than WebSockets because it is one plain HTTP response:
// nothing extra to host, it survives the proxies in front of the app, and the
// browser reconnects on its own if the connection drops.
//
// The connection is per viewer and the query is scoped the same way the page
// is, so an employee's stream can never carry the manager's private exchanges
// with the assistant.

export const dynamic = "force-dynamic";
// Streaming responses must not be buffered or collapsed by any cache.
export const revalidate = 0;

const POLL_MS = 1500;
// Render closes an idle connection after a while; ending it ourselves first
// means the browser reconnects cleanly instead of seeing a broken pipe.
const MAX_LIFETIME_MS = 4 * 60_000;

function visibility(viewer: ChatViewer) {
  return viewer.type === "ADMIN" ? {} : { managerOnly: false };
}

export async function GET(request: Request) {
  const viewer = await getChatViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });

  const channel = await getTeamChannel();
  const url = new URL(request.url);

  // Everything after this instant is new. The client sends the timestamp of
  // the newest message it already has, so a reconnect never repeats or skips.
  const since = url.searchParams.get("since");
  let cursor = since && !Number.isNaN(Date.parse(since)) ? new Date(since) : new Date();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
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
          // Already closed by the client going away.
        }
      };

      // Tells the browser to reconnect quickly, and proves the stream is open.
      send("ready", { at: cursor.toISOString() });

      const timer = setInterval(async () => {
        if (closed) return;
        try {
          const messages = await prisma.chatMessage.findMany({
            where: {
              channelId: channel.id,
              ...visibility(viewer),
              createdAt: { gt: cursor },
            },
            orderBy: { createdAt: "asc" },
            take: 50,
            select: {
              id: true,
              authorType: true,
              authorId: true,
              authorName: true,
              kind: true,
              body: true,
              attachmentUrl: true,
              attachmentName: true,
              attachmentType: true,
              attachmentSize: true,
              durationSeconds: true,
              managerOnly: true,
              createdAt: true,
              project: { select: { id: true, name: true } },
            },
          });

          if (messages.length > 0) {
            cursor = messages[messages.length - 1].createdAt;
            send("messages", messages);
          } else {
            // A comment frame keeps proxies from closing an idle connection.
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          }
        } catch {
          // A database hiccup should drop the stream, not crash the route —
          // the browser reconnects and picks up from its own cursor.
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
      // Nginx and friends buffer by default, which would hold every message
      // until the response ended.
      "X-Accel-Buffering": "no",
    },
  });
}
