import { channelFor, chatSide, getChatViewer, parseConversation } from "@/lib/chat";
import {
  CallError,
  addableToCall,
  declineCall,
  heartbeat,
  inviteToCall,
  joinCall,
  leaveCall,
  markAway,
  startCall,
} from "@/lib/call-store";
import { mayCallIn } from "@/lib/calls";
import { iceServers } from "@/lib/ice-servers";
import { sameOrigin } from "@/lib/request-origin";

// Starting, answering, declining and leaving a call, an open call saying it is
// still there, and a page on its way out keeping its place.
//
// A route handler rather than server actions: a page runs its server actions
// one at a time, and a call cannot wait behind whatever else the page is
// doing; and a closing tab can only say it is leaving with sendBeacon, which
// posts to a URL. The body is read as text so a beacon's plain body works too.

export const dynamic = "force-dynamic";

type Body = { action?: unknown; as?: unknown; conversation?: unknown; kind?: unknown; callId?: unknown; members?: unknown };

const failure = (message: string, status: number) => Response.json({ error: message }, { status });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return failure("Forbidden", 403);

  let body: Body;
  try {
    body = JSON.parse(await request.text()) as Body;
  } catch {
    return failure("That request could not be read.", 400);
  }

  const viewer = await getChatViewer(chatSide(typeof body.as === "string" ? body.as : null));
  if (!viewer) return failure("Sign in again to make calls.", 401);

  const callId = typeof body.callId === "string" ? body.callId : "";

  try {
    switch (body.action) {
      case "start": {
        const conversation = parseConversation(typeof body.conversation === "string" ? body.conversation : null, viewer);
        const channel = conversation ? await channelFor(viewer, conversation) : null;
        if (!conversation || !channel || !mayCallIn(conversation)) return failure("Calls cannot be made in this chat.", 400);

        const started = await startCall(viewer, conversation, channel.id, body.kind === "VIDEO" ? "VIDEO" : "AUDIO");
        return Response.json({ ...started, iceServers: await iceServers() });
      }
      case "join":
        await joinCall(viewer, callId);
        return Response.json({ callId, iceServers: await iceServers() });
      case "decline":
        await declineCall(viewer, callId);
        return Response.json({ ok: true });
      case "leave":
        await leaveCall(viewer, callId);
        return Response.json({ ok: true });
      // A page that is unloading — reloaded or closed, the browser cannot say
      // which. It keeps its place for AWAY_GRACE_MS rather than leaving.
      case "away":
        await markAway(viewer, callId);
        return Response.json({ ok: true });
      case "heartbeat":
        return Response.json({ inCall: await heartbeat(viewer, callId) });
      // Who else could be asked into this call, and asking them. Both refuse
      // anybody who is not themselves in it.
      case "addable":
        return Response.json({ members: await addableToCall(viewer, callId) });
      case "invite": {
        const keys = Array.isArray(body.members) ? body.members.filter((key): key is string => typeof key === "string") : [];
        return Response.json(await inviteToCall(viewer, callId, keys));
      }
      default:
        return failure("That is not something a call can do.", 400);
    }
  } catch (error) {
    if (error instanceof CallError) return failure(error.message, 409);
    return failure("Something went wrong with the call. Try again.", 500);
  }
}
