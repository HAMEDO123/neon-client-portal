import { NextResponse } from "next/server";
import { channelFor, listMessages, parseConversation } from "@/lib/chat";
import { postChatMessage } from "@/lib/chat-send";
import { mobileViewer } from "@/lib/mobile-auth";

// Reading and writing one conversation from a phone.
//
// A conversation is named exactly as it is on the web — "team", "manager", or
// an id — and what that name means depends on who is asking, which is why it
// goes through `parseConversation` with the viewer. `channelFor` is the access
// check: it refuses a conversation that is not theirs, so an id from somewhere
// else finds nothing rather than somebody else's messages.

export const dynamic = "force-dynamic";

const MAX_BODY = 4000;

/** The conversation a request names, opened for this viewer. */
async function open(viewer: Awaited<ReturnType<typeof mobileViewer>>, named: string | null) {
  if (!viewer) return null;
  const conversation = parseConversation(named && named.trim() ? named : "team", viewer);
  if (!conversation) return null;
  const channel = await channelFor(viewer, conversation);
  return channel ? { conversation, channel } : null;
}

export async function GET(request: Request) {
  const viewer = await mobileViewer(request);
  if (!viewer) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const url = new URL(request.url);
  const opened = await open(viewer, url.searchParams.get("conversation"));
  if (!opened) return NextResponse.json({ error: "That conversation is not yours." }, { status: 404 });

  const asked = Number(url.searchParams.get("take") ?? 100);
  const take = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), 200) : 100;

  return NextResponse.json({ messages: await listMessages(viewer, opened.channel.id, take) });
}

export async function POST(request: Request) {
  const viewer = await mobileViewer(request);
  if (!viewer) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const opened = await open(viewer, typeof body?.conversation === "string" ? body.conversation : null);
  if (!opened) return NextResponse.json({ error: "That conversation is not yours." }, { status: 404 });

  const text = typeof body?.body === "string" ? body.body.trim().slice(0, MAX_BODY) : "";
  // Text only for now. Photos, files and voice notes are saved through
  // `saveFile` and need a multipart upload, which is its own piece of work.
  if (!text) return NextResponse.json({ error: "Nothing to send." }, { status: 400 });

  const message = await postChatMessage(viewer, opened.conversation, opened.channel.id, {
    kind: "TEXT",
    body: text,
    projectId: typeof body?.projectId === "string" && body.projectId ? body.projectId : null,
  });

  return NextResponse.json({ message });
}
