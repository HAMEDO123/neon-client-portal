import { NextResponse } from "next/server";
import { mobileChatViewer } from "@/lib/mobile-auth";
import { respondToMeeting } from "@/lib/meeting-rsvp";

/**
 * Answering an invitation: coming, not coming, or back to unanswered.
 *
 * Silence is never read as a refusal anywhere in the platform — INVITED means
 * asked and not yet answered, and the app must be able to put somebody back
 * there, which is why "INVITED" is an answer this accepts rather than only the
 * two decisions.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await mobileChatViewer(request);
  if (!viewer) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const answer = typeof body?.rsvp === "string" ? body.rsvp : "";

  const result = await respondToMeeting(viewer, (await params).id, answer);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.status });
  }

  return NextResponse.json({ rsvp: answer });
}
