import { prisma } from "@/lib/db";
import { channelFor, messageSelect, parseConversation } from "@/lib/chat";
import { taskSignature, taskSnapshot } from "@/lib/chat-task-store";
import { meetingSignature, meetingSnapshot } from "@/lib/chat-meeting-store";
import { reactionSignature, reactionSnapshot } from "@/lib/chat-reaction-store";
import { readMarksFor, typingIn } from "@/lib/presence-store";
import { mobileViewer } from "@/lib/mobile-auth";
import type { ChatViewer } from "@/lib/chat-conversations";

// Live chat for the phone, over Server-Sent Events — the same connection the
// web's /api/chat/stream keeps open, mirrored here with the app's bearer
// token in place of a session cookie. See that route's own comment for what
// each of the five kinds of news means: `messages`, `tasks`, `meetings`,
// `reactions`, `people`.
//
// One connection per open conversation, opened through channelFor like every
// other read: an employee's stream can carry the team and their own private
// chats, never somebody else's, and never the manager's private exchanges
// with the assistant.

export const dynamic = "force-dynamic";
export const revalidate = 0;

const POLL_MS = 1500;
// Render closes an idle connection after a while; ending it ourselves first
// means the app reconnects cleanly instead of seeing a broken pipe.
const MAX_LIFETIME_MS = 4 * 60_000;

function visibility(viewer: ChatViewer) {
  return viewer.type === "ADMIN" ? {} : { managerOnly: false };
}

export async function GET(request: Request) {
  const viewer = await mobileViewer(request);
  if (!viewer) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  // A connection opened before naming a conversation means the team, exactly
  // as the web's does.
  const conversation = parseConversation(url.searchParams.get("with") || "team", viewer);
  const channel = conversation ? await channelFor(viewer, conversation) : null;
  if (!channel) return new Response("Forbidden", { status: 403 });

  // Everything after this instant is new. The app sends the timestamp of the
  // newest message it already has, so a reconnect never repeats or skips.
  const since = url.searchParams.get("since");
  let cursor = since && !Number.isNaN(Date.parse(since)) ? new Date(since) : new Date();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let busy = false;
      const clocks: { poll?: ReturnType<typeof setInterval>; lifetime?: ReturnType<typeof setTimeout> } = {};
      // Empty, so the first look always sends the cards: one that changed
      // between the app's last read and this connection opening is not missed.
      let tasksSeen = "";
      let meetingsSeen = "";
      let reactionsSeen = "";
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

      const syncReactions = async () => {
        const signature = await reactionSignature(channel.id);
        if (signature === reactionsSeen) return false;
        reactionsSeen = signature;
        send("reactions", await reactionSnapshot(channel.id));
        return true;
      };

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

      send("ready", { at: cursor.toISOString() });

      try {
        await syncTasks();
        await syncMeetings();
        await syncReactions();
        await syncPeople();
      } catch {
        finish();
        return;
      }

      clocks.poll = setInterval(async () => {
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
          const reactionsChanged = await syncReactions();
          const peopleChanged = await syncPeople();

          if (
            messages.length === 0 &&
            !tasksChanged &&
            !meetingsChanged &&
            !reactionsChanged &&
            !peopleChanged &&
            !closed
          ) {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          }
        } catch {
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
      "X-Accel-Buffering": "no",
    },
  });
}
