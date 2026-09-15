import { chatSide, getChatViewer } from "@/lib/chat";
import { CallError, sendSignals, type OutgoingSignal } from "@/lib/call-store";
import { sameOrigin } from "@/lib/request-origin";

// What one device in a call sends the others to connect: its session
// description, and the network addresses it can be reached on, in batches.
// Only ever delivered to people in the same call (sendSignals checks).

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Forbidden" }, { status: 403 });

  let body: { as?: unknown; callId?: unknown; signals?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "That request could not be read." }, { status: 400 });
  }

  const viewer = await getChatViewer(chatSide(typeof body.as === "string" ? body.as : null));
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
