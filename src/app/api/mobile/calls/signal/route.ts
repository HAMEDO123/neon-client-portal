import { CallError, sendSignals, type OutgoingSignal } from "@/lib/call-store";
import { mobileViewer } from "@/lib/mobile-auth";

// What one device in a call sends the others to connect — the phone's version
// of src/app/api/calls/signal/route.ts. Same rules (sendSignals only ever
// delivers to people in the same call), the viewer is the app's bearer token,
// and there is no sameOrigin check (see the comment in route.ts beside this).

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { callId?: unknown; signals?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "That request could not be read." }, { status: 400 });
  }

  const viewer = await mobileViewer(request);
  if (!viewer) return Response.json({ error: "Sign in again to make calls." }, { status: 401 });
  if (typeof body.callId !== "string" || !Array.isArray(body.signals)) {
    return Response.json({ error: "That request could not be read." }, { status: 400 });
  }

  try {
    const sent = await sendSignals(viewer, body.callId, body.signals as OutgoingSignal[]);
    return Response.json({ sent });
  } catch (error) {
    if (error instanceof CallError) return Response.json({ error: error.message }, { status: 409 });
    return Response.json({ error: "Could not reach the call." }, { status: 500 });
  }
}
