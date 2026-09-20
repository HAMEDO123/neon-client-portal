import { NextResponse } from "next/server";
import { channelFor, parseConversation, recordChatRead } from "@/lib/chat";
import { mobileViewer } from "@/lib/mobile-auth";

// Marking a conversation read from the phone, so the unread count the web shows
// and the one the app shows are the same number.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const viewer = await mobileViewer(request);
  if (!viewer) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const named = typeof body?.conversation === "string" && body.conversation.trim() ? body.conversation : "team";

  const conversation = parseConversation(named, viewer);
  if (!conversation) return NextResponse.json({ error: "That conversation is not yours." }, { status: 404 });

  const channel = await channelFor(viewer, conversation);
  if (!channel) return NextResponse.json({ error: "That conversation is not yours." }, { status: 404 });

  await recordChatRead(viewer, channel.id);
  return NextResponse.json({ ok: true });
}
