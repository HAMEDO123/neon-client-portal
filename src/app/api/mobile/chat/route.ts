import { NextResponse } from "next/server";
import { mobileChatViewer } from "@/lib/mobile-auth";
import { conversationsFor } from "@/lib/chat";

// The app's chat list: every conversation this person is in, newest first,
// with the last line and how much of it they have not read.
//
// `conversationsFor` is the web portal's own query — one SQL statement with a
// LATERAL — so the app's list cannot drift from the browser's, and an employee
// still cannot see a conversation that is not theirs: the access rules live
// inside it, not in this route.

export async function GET(request: Request) {
  const viewer = await mobileChatViewer(request);
  if (!viewer) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  return NextResponse.json({ conversations: await conversationsFor(viewer) });
}
