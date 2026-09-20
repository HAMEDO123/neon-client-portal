import { NextResponse } from "next/server";
import { conversationsFor } from "@/lib/chat";
import { mobileViewer } from "@/lib/mobile-auth";

// Every conversation the signed-in person is in, with its last message and
// unread count — the phone app's chat list.
//
// The same `conversationsFor` the web uses, so the list is built once: who can
// see which conversation is decided there and nowhere else.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await mobileViewer(request);
  if (!viewer) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  return NextResponse.json({ viewer: { side: viewer.type, name: viewer.name }, conversations: await conversationsFor(viewer) });
}
