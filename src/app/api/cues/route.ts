import { chatSide, getChatViewer } from "@/lib/chat";
import { latestCues } from "@/lib/cues";

// The newest message and the newest other notification for whoever asks: the
// app's cue to play one sound or the other. See cues.ts.

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  // Each portal asks for its own side's sounds.
  const viewer = await getChatViewer(chatSide(new URL(request.url).searchParams.get("as")));
  if (!viewer) return new Response("Unauthorized", { status: 401 });

  try {
    return Response.json(await latestCues(viewer), { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Not a zero: a client that took zeros for an answer would hear every old
    // message again on the next good one. It ignores anything that is not ok.
    return new Response("Unavailable", { status: 503 });
  }
}
