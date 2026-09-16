import { prisma } from "@/lib/db";
import {
  channelFor,
  chatSide,
  getChatViewer,
  messageSelect,
  parseConversation,
  type ChatViewer,
} from "@/lib/chat";
import { taskSignature, taskSnapshot } from "@/lib/chat-task-store";
import { meetingSignature, meetingSnapshot } from "@/lib/chat-meeting-store";
import { readMarksFor, typingIn } from "@/lib/presence-store";

// Live chat, over Server-Sent Events.
//
// The browser holds this connection open and the server writes to it as
// messages arrive, so a message someone else sends appears without anyone
// reloading. SSE rather than WebSockets because it is one plain HTTP response:
// nothing extra to host, it survives the proxies in front of the app, and the
// browser reconnects on its own if the connection drops.
//
// One connection per open conversation, opened through channelFor like every
// other read: an employee's stream can carry the team and their own private
// chats, never somebody else's, and never the manager's private exchanges with
// the assistant.
//
// Four kinds of news: `messages`, each new message once; `tasks`, the
// conversation's task cards whenever anything about them changes — somebody
// starting their part, a photo arriving or being reviewed, a comment — none of
// which is a new message; `meetings`, the same for meeting cards, which change
// when somebody says whether they are coming; and `people`, who is writing in
// this conversation and how far each person has read it, which is what a
// typing line and a read tick are drawn from.

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
  const url = new URL(request.url);
  // The portal the chat is open in says whose session this is.
  const viewer = await getChatViewer(chatSide(url.searchParams.get("as")));
  if (!viewer) return new Response("Unauthorized", { status: 401 });

  // A tab opened before private chats existed names no conversation, and means the team.
  const conversation = parseConversation(url.searchParams.get("with") || "team", viewer);
  const channel = conversation ? await channelFor(viewer, conversation) : null;
  if (!channel) return new Response("Forbidden", { status: 403 });

  // Everything after this instant is new. The client sends the timestamp of
  // the newest message it already has, so a reconnect never repeats or skips.
  const since = url.searchParams.get("since");
  let cursor = since && !Number.isNaN(Date.parse(since)) ? new Date(since) : new Date();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let busy = false;
      // Set once the first look is done; finish may run before either exists.
      const clocks: { poll?: ReturnType<typeof setInterval>; lifetime?: ReturnType<typeof setTimeout> } = {};
      // Empty, so the first look always sends the cards: one that changed
      // between the page being drawn and this connection opening is not missed.
      let tasksSeen = "";
      let meetingsSeen = "";
      let peopleSeen = "";

      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(clocks.poll);
        clearTimeout(clocks.lifetime);
        try {
          controller.close();
        } catch {
          // Already closed by the client going away.
        }
      };

      const syncTasks = async () => {
        const signature = await taskSignature(channel.id);
        if (signature === tasksSeen) return false;
        tasksSeen = signature;
        send("tasks", await taskSnapshot(channel.id));
        return true;
      };

      const syncMeetings = async () => {
        const signature = await meetingSignature(channel.id);
        if (signature === meetingsSeen) return false;
        meetingsSeen = signature;
        send("meetings", await meetingSnapshot(channel.id));
        return true;
      };

      // Who is writing, and how far each person has read. Both are about
      // somebody other than the viewer, and neither is a new message — so like
      // the cards, they are sent only when they actually move. One after the
      // other, not together: this runs on every poll of every open conversation.
      const syncPeople = async () => {
        const typing = await typingIn(channel.id);
        const reads = await readMarksFor(channel.id);
        const signature = [
          typing.map((one) => one.memberKey).join(","),
          reads.map((mark) => `${mark.readerKey}:${mark.lastReadAt.getTime()}`).join(","),
        ].join("|");
        if (signature === peopleSeen) return false;
        peopleSeen = signature;
        send("people", {
          typing,
          reads: reads.map((mark) => ({ key: mark.readerKey, at: mark.lastReadAt.toISOString() })),
        });
        return true;
      };

      request.signal.addEventListener("abort", finish);

      // Tells the browser to reconnect quickly, and proves the stream is open.
      send("ready", { at: cursor.toISOString() });

      try {
        await syncTasks();
        await syncMeetings();
        await syncPeople();
      } catch {
        finish();
        return;
      }

      clocks.poll = setInterval(async () => {
        // A slow database must not stack one look on top of the last.
        if (closed || busy) return;
        busy = true;
        try {
          const messages = await prisma.chatMessage.findMany({
            where: {
              channelId: channel.id,
              ...visibility(viewer),
              createdAt: { gt: cursor },
            },
            orderBy: { createdAt: "asc" },
            take: 50,
            select: messageSelect,
          });

          if (messages.length > 0) {
            cursor = messages[messages.length - 1].createdAt;
            send("messages", messages);
          }

          const tasksChanged = await syncTasks();
          const meetingsChanged = await syncMeetings();
          const peopleChanged = await syncPeople();

          if (messages.length === 0 && !tasksChanged && !meetingsChanged && !peopleChanged && !closed) {
            // A comment frame keeps proxies from closing an idle connection.
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          }
        } catch {
          // A database hiccup should drop the stream, not crash the route —
          // the browser reconnects and picks up from its own cursor.
          finish();
        } finally {
          busy = false;
        }
      }, POLL_MS);

      clocks.lifetime = setTimeout(finish, MAX_LIFETIME_MS);
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
