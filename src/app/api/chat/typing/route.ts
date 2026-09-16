import { channelFor, chatSide, getChatViewer, parseConversation } from "@/lib/chat";
import { sameOrigin } from "@/lib/request-origin";
import { memberKeyFor, setTyping } from "@/lib/presence-store";

// "Wael is writing…" — the one write behind it.
//
// A route handler rather than a server action for the same reason the calls
// endpoints are: a page runs its server actions one at a time, and a keystroke
// note must never queue behind a message being sent or a photo being uploaded.
//
// Route handlers get no origin check of their own, so this does its own, and
// the identity comes from the session cookie — a browser may hold both, so the
// portal says which side it is on and gets that session or nobody.
//
// Nothing is swept: a note nobody cleared falls outside the window the moment
// it is read, so stopping typing and losing the connection look the same, which
// is the honest answer in both cases.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });

  let body: { conversation?: unknown; as?: unknown; typing?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const viewer = await getChatViewer(chatSide(typeof body.as === "string" ? body.as : undefined));
  if (!viewer) return new Response("Unauthorized", { status: 401 });

  // Stopping needs no conversation: it clears whatever was there.
  if (body.typing === false) {
    await setTyping(memberKeyFor(viewer), null);
    return new Response(null, { status: 204 });
  }

  const conversation = parseConversation(typeof body.conversation === "string" ? body.conversation : "", viewer);
  // The same door as every other read: a conversation is only ever reached
  // through channelFor, so nobody can announce themselves into a chat they
  // cannot open.
  const channel = conversation ? await channelFor(viewer, conversation) : null;
  if (!channel) return new Response("Forbidden", { status: 403 });

  await setTyping(memberKeyFor(viewer), channel.id);
  return new Response(null, { status: 204 });
}
