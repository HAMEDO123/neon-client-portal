import { CAMERA_ERRORS, cameraIdParam, snapshotWidth } from "@/lib/cameras";
import { json } from "@/lib/mobile/rpc";
import { camerasGate, fetchFrame } from "@/lib/mobile/cameras-relay";
import { streamFor } from "@/lib/mobile/cameras-service";

// One camera's picture as it is now: a JPEG, for the grid's tiles, which ask
// again every couple of seconds while they are on screen.
//
//   GET /api/mobile/cameras/<id>/frame[?width=640]
//
// The id is looked up first (streamFor): a camera added in the app — its
// streams registered with the relay again if the relay has restarted since —
// or one written into go2rtc.yaml by hand. Only then is the relay asked, by
// the stream's own name: go2rtc would otherwise take an address in its place
// and fetch it. `width` scales the picture down on the office PC, so a tile on
// a mobile connection does not download a full frame every two seconds.
//
// 404 an unknown camera · 503 the relay is not running · 502/504 the camera
// sent no picture. Never cached: a snapshot is only worth anything now.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const refused = camerasGate(request);
  if (refused) return refused;

  const id = cameraIdParam((await context.params).id);
  if (!id) return json({ error: CAMERA_ERRORS.notFound }, 404);

  const found = await streamFor(id, "frame");
  if (!found.ok) return found.response;

  const width = snapshotWidth(new URL(request.url).searchParams.get("width"));
  const frame = await fetchFrame(found.name, width, request.signal);
  if (!frame.ok) return json({ error: frame.error }, frame.status);

  return new Response(frame.bytes, {
    headers: {
      "content-type": "image/jpeg",
      "content-length": String(frame.bytes.byteLength),
      "cache-control": "private, no-store, max-age=0",
    },
  });
}
