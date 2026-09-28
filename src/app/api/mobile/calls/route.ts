import { channelFor, parseConversation } from "@/lib/chat";
import { CallError, declineCall, heartbeat, joinCall, leaveCall, startCall } from "@/lib/call-store";
import { mayCallIn } from "@/lib/calls";
import { iceServers } from "@/lib/ice-servers";
import { mobileViewer } from "@/lib/mobile-auth";

// Starting, answering, declining and leaving a call, and an open call saying
// it is still there — the phone's version of src/app/api/calls/route.ts.
//
// Same behaviour as the web route, with two differences: the viewer comes
// from the app's bearer token (mobileViewer) rather than a cookie, and there
// is no sameOrigin check — a bearer token is attached by nothing but the app
// that holds it, so there is no cross-site request to forge (see the comment
// on mobileViewer in src/lib/mobile-auth.ts). Every rule underneath — who may
// call whom, how a call rings and ends — is the same lib/calls.ts and
// lib/call-store.ts the web route calls; nothing here is copied from them.

export const dynamic = "force-dynamic";

type Body = { action?: unknown; conversation?: unknown; kind?: unknown; callId?: unknown };

const failure = (message: string, status: number) => Response.json({ error: message }, { status });

export async function POST(request: Request) {
  let body: Body;
  try {
    body = JSON.parse(await request.text()) as Body;
  } catch {
    return failure("That request could not be read.", 400);
  }

  const viewer = await mobileViewer(request);
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
      case "heartbeat":
        return Response.json({ inCall: await heartbeat(viewer, callId) });
      default:
        return failure("That is not something a call can do.", 400);
    }
  } catch (error) {
    if (error instanceof CallError) return failure(error.message, 409);
    return failure("Something went wrong with the call. Try again.", 500);
  }
}
