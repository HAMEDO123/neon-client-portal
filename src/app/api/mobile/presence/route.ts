import { NextResponse } from "next/server";
import { mobileViewer } from "@/lib/mobile-auth";
import { beat, memberKeyFor } from "@/lib/presence-store";

// The phone's heartbeat: the app is open and in front of this person.
//
// The web's heartbeat is the /api/live connection a page holds open; the app
// cannot hold one while it is in the background, so it calls this every
// HEARTBEAT_MS (30 s) while it is in the foreground instead. It writes the very
// same ChatPresence row — "admin" for the manager, the employee id otherwise —
// so somebody on the app shows as online on the website, and the other way
// round, with the same window (lib/presence.ts) deciding both.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const viewer = await mobileViewer(request);
  if (!viewer) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  await beat(memberKeyFor(viewer));
  return NextResponse.json({ ok: true });
}
