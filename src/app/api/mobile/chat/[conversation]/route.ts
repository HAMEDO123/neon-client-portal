import { NextResponse } from "next/server";
import { mobileChatViewer } from "@/lib/mobile-auth";
import { channelFor, listMessages, parseConversation, recordChatRead } from "@/lib/chat";
import { postChatMessage } from "@/lib/chat-send";

// One conversation: read it, and post to it.
//
// The conversation is named the way the web URLs name it — "team", "manager",
// or the other person's id — and is resolved through `parseConversation` and
// `channelFor`, which is the access check for both portals. A conversation
// that is not this viewer's resolves to nothing and answers 404, never a page
// of somebody else's messages.

async function open(request: Request, conversation: string) {
  const viewer = await mobileChatViewer(request);
  if (!viewer) return { error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };

  const parsed = parseConversation(conversation || "team", viewer);
  const channel = parsed ? await channelFor(viewer, parsed) : null;
  if (!parsed || !channel) {
    return { error: NextResponse.json({ error: "No such conversation." }, { status: 404 }) };
  }

  return { viewer, conversation: parsed, channel };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ conversation: string }> }
) {
  const opened = await open(request, (await params).conversation);
  if (opened.error) return opened.error;

  const messages = await listMessages(opened.viewer, opened.channel.id);

  // Opening a conversation is reading it, the same as on the web — otherwise
  // the badge on the app and the badge in the browser disagree about the same
  // person's unread count.
  await recordChatRead(opened.viewer, opened.channel.id);

  return NextResponse.json({ conversation: opened.conversation, messages });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversation: string }> }
) {
  const name = (await params).conversation;
  const opened = await open(request, name);
  if (opened.error) return opened.error;

  const body = await request.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body : "";
  const projectId = typeof body?.projectId === "string" ? body.projectId : null;

  // Text only for now. Photos and voice notes go through `postChatMessage`
  // just as the web's do, but they arrive as multipart rather than JSON and
  // the app has no uploader yet — so this route refuses them rather than
  // pretending to accept one and dropping it.
  const message = await postChatMessage(opened.viewer, name, { body: text, projectId });
  if (!message) {
    return NextResponse.json({ error: "Nothing to send." }, { status: 400 });
  }

  return NextResponse.json({ message });
}
