import { NextResponse } from "next/server";
import { mobileChatViewer } from "@/lib/mobile-auth";
import { meetingListFor } from "@/lib/chat-meeting-store";

// The meetings this person was asked to, soonest first.
//
// `meetingListFor` is the web portal's own query and carries the access rules
// with it: a meeting lives in a conversation, and somebody who cannot open the
// conversation never sees its card.

export async function GET(request: Request) {
  const viewer = await mobileChatViewer(request);
  if (!viewer) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  return NextResponse.json({ meetings: await meetingListFor(viewer) });
}
