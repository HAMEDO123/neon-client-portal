import { CAMERA_ERRORS, cameraIdParam } from "@/lib/cameras";
import { json } from "@/lib/mobile/rpc";
import { camerasGate, openLive } from "@/lib/mobile/cameras-relay";
import { streamFor } from "@/lib/mobile/cameras-service";

// One camera, live: the relay's MJPEG stream (`multipart/x-mixed-replace`)
// passed through to the manager's phone as it arrives, for as long as they
// watch.
//
//   GET /api/mobile/cameras/<id>/live[?quality=hd]
//
// The camera's small picture by default (640×360, as the camera sends it);
// `quality=hd` is its full picture scaled to 1280 wide at ten frames a second
// — sharper to zoom into, and several times the data.
//
// The app reads JPEG frames out of the bytes itself (FFD8 … FFD9), so nothing
// here re-frames anything. The stream ends with the phone: `request.signal`
// aborts the connection to the relay the moment the phone hangs up, and go2rtc
// stops transcoding for a viewer who has gone. It also ends after a long while
// regardless (LIVE_MAX_MS in lib/mobile/cameras-relay.ts) and the app simply
// opens the next one.
//
// Long-lived on purpose, and fine through the tunnel: cloudflared passes a
// streaming response through as it is written, and an MJPEG stream is never
// idle long enough for Cloudflare to close it. `no-transform` keeps anything in
// between — Next's own compression included — from holding it to compress it.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const refused = camerasGate(request);
  if (refused) return refused;

  const id = cameraIdParam((await context.params).id);
  if (!id) return json({ error: CAMERA_ERRORS.notFound }, 404);

  const hd = new URL(request.url).searchParams.get("quality") === "hd";
  const found = await streamFor(id, hd ? "live-hd" : "live");
  if (!found.ok) return found.response;

  const live = await openLive(found.name, request.signal);
  if (!live.ok) return json({ error: live.error }, live.status);

  return new Response(live.body, {
    headers: {
      "content-type": live.contentType,
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
