import { verifyEmployeeSessionToken } from "@/lib/auth";
import { CAMERA_ERRORS, isCameraId, isMjpegStream, looksLikeJpeg, relayBase, relayUrl } from "@/lib/cameras";
import { requireMobileAuth } from "@/lib/mobile-auth";
import { json } from "@/lib/mobile/rpc";

// The camera relay on the office PC — go2rtc, the `neon-cameras` service in
// docker-compose.yml — as the site talks to it. See lib/cameras.ts for what it
// is and the rules that keep it safe.
//
// What is used of go2rtc 1.9.14's API, checked against its source and against
// a running relay:
//
//   GET    /api/streams                       every stream (sources, passwords and all: never passed on)
//   GET    /api/streams?src=<name>&video=     connect to it once; a 500 says why not, in go2rtc's words
//   PATCH  /api/streams?name=<name>&src=<s>   add or change a stream — in memory only, never in go2rtc.yaml
//   DELETE /api/streams?src=<name>            drop it (answers 400 "path not exist" for one that was never in the file, having dropped it all the same)
//   PUT    /api/preload?src=<name>&video=     keep it connected with nobody watching (go2rtc writes the name, never the source, into go2rtc.yaml)
//   DELETE /api/preload?src=<name>
//   GET    /api/frame.jpeg?src=<name>[&width] the next keyframe as a JPEG (an empty 200 when the camera cannot be reached)
//   GET    /api/stream.mjpeg?src=<name>       multipart/x-mixed-replace; its headers come with the first frame
//
// The relay is optional — an office with no cameras yet, or with the relay
// stopped, still runs the site — so nothing here throws at its callers: every
// failure comes back as a value.

function base(): string {
  return relayBase(process.env.CAMERAS_RELAY_URL);
}

const QUICK_MS = 4_000;

// --- Who may watch -----------------------------------------------------------

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

/**
 * The manager, and nobody else: `null` lets the request through, anything else
 * is the answer. Somebody on the team is refused with 403 — signed in, just not
 * to this — and no token at all is a 401, which the app answers by signing out.
 *
 * A signature check only, deliberately: the manager's token never needs the
 * database, so a picture is never held up by it, and an employee's token is
 * refused whatever the database would say about them.
 */
export function camerasGate(request: Request): Response | null {
  if (requireMobileAuth(request)) return null;
  if (verifyEmployeeSessionToken(bearer(request))) return json({ error: CAMERA_ERRORS.managerOnly }, 403);
  return json({ error: "Unauthorized." }, 401);
}

// --- Managing streams ------------------------------------------------------------

async function call(method: string, path: string, params: Record<string, string>, timeoutMs = QUICK_MS) {
  const query = new URLSearchParams(params).toString();
  try {
    const response = await fetch(`${base()}${path}${query ? `?${query}` : ""}`, {
      method,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { reached: true as const, status: response.status, text: await response.text().catch(() => "") };
  } catch {
    return { reached: false as const, status: 0, text: "" };
  }
}

/**
 * Every stream the relay has, as go2rtc lists them — or null when it cannot be
 * reached or is not go2rtc. **Server-side only**: its values carry every
 * camera's source address with the password in it.
 */
export async function relayStreams(): Promise<Record<string, unknown> | null> {
  const answer = await call("GET", "/api/streams", {});
  if (!answer.reached || answer.status !== 200) return null;
  try {
    const body = JSON.parse(answer.text) as unknown;
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The streams the relay keeps connected with nobody watching. */
export async function relayPreloads(): Promise<Set<string> | null> {
  const answer = await call("GET", "/api/preload", {});
  if (!answer.reached || answer.status !== 200) return null;
  try {
    const body = JSON.parse(answer.text) as unknown;
    return typeof body === "object" && body !== null ? new Set(Object.keys(body)) : null;
  } catch {
    return null;
  }
}

/** Adds or replaces one stream, in the relay's memory only. */
export async function registerStream(name: string, source: string): Promise<boolean> {
  if (!isCameraId(name)) return false;
  const answer = await call("PATCH", "/api/streams", { name, src: source });
  return answer.reached && answer.status === 200;
}

export async function removeStream(name: string): Promise<void> {
  if (!isCameraId(name)) return;
  await call("DELETE", "/api/streams", { src: name });
}

/**
 * Keeps a stream connected with nobody watching, so a snapshot only waits for
 * the camera's next keyframe instead of a new connection every two seconds.
 * Answers go2rtc's reason when the camera could not be reached, or null.
 */
export async function addPreload(name: string): Promise<string | null> {
  if (!isCameraId(name)) return "Not a stream name.";
  const answer = await call("PUT", "/api/preload", { src: name, video: "" }, 15_000);
  if (!answer.reached) return "The relay did not answer.";
  return answer.status === 200 ? null : answer.text.trim() || `HTTP ${answer.status}`;
}

export async function removePreload(name: string): Promise<void> {
  if (!isCameraId(name)) return;
  await call("DELETE", "/api/preload", { src: name });
}

/** Connects to a stream once, to see whether it works. go2rtc's reason when it does not. */
export async function probeStream(name: string, timeoutMs = 15_000): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isCameraId(name)) return { ok: false, error: "not a stream" };
  const answer = await call("GET", "/api/streams", { src: name, video: "" }, timeoutMs);
  if (!answer.reached) return { ok: false, error: "timeout" };
  if (answer.status === 200) return { ok: true };
  return { ok: false, error: answer.text.trim() || `HTTP ${answer.status}` };
}

// --- A snapshot ------------------------------------------------------------------

/**
 * A snapshot waits for the camera's next keyframe — up to a couple of seconds
 * on a Tapo — then ffmpeg on the relay turns it into a JPEG. A camera that has
 * not answered in this long is not going to.
 */
const FRAME_TIMEOUT_MS = 12_000;

export type FrameResult = { ok: true; bytes: Uint8Array<ArrayBuffer> } | { ok: false; status: number; error: string };

export async function fetchFrame(name: string, width: number | null, signal: AbortSignal): Promise<FrameResult> {
  let response: Response;
  try {
    response = await fetch(relayUrl(base(), "frame", name, width), {
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(FRAME_TIMEOUT_MS)]),
    });
  } catch {
    return { ok: false, status: signal.aborted ? 499 : 504, error: CAMERA_ERRORS.noPicture };
  }

  // go2rtc answers a camera it cannot reach with an empty 200, and a failed
  // transcode with ffmpeg's own words (which can name addresses): neither is
  // passed on. Only a JPEG is.
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return { ok: false, status: 502, error: CAMERA_ERRORS.noPicture };
  }
  if (!response.ok || !(response.headers.get("content-type") ?? "").startsWith("image/jpeg") || !looksLikeJpeg(bytes)) {
    return { ok: false, status: 502, error: CAMERA_ERRORS.noPicture };
  }
  return { ok: true, bytes };
}

// --- The live picture ---------------------------------------------------------------

/**
 * go2rtc sends the stream's headers with its first frame, and the first frame
 * waits for ffmpeg on the relay to start and for the camera's next keyframe —
 * a few seconds. Longer than this and the camera is not coming.
 */
const LIVE_START_TIMEOUT_MS = 20_000;

/**
 * However long somebody watches, one connection ends after this and the app
 * opens the next one at once, keeping the last frame on screen. It bounds what
 * a phone that vanished without closing its connection can cost the office PC:
 * a transcoder running for nobody.
 */
export const LIVE_MAX_MS = 30 * 60_000;

export type LiveResult =
  | { ok: true; body: ReadableStream<Uint8Array>; contentType: string }
  | { ok: false; status: number; error: string };

/**
 * The relay's MJPEG stream for one stream name, passed through as it arrives.
 * It ends when the phone goes away (`clientGone`), when the camera stops, or
 * after LIVE_MAX_MS — and whichever it is, the connection to the relay is
 * closed with it, so go2rtc stops transcoding for a viewer who is not there.
 */
export async function openLive(name: string, clientGone: AbortSignal): Promise<LiveResult> {
  const upstream = new AbortController();
  const stop = () => upstream.abort();
  clientGone.addEventListener("abort", stop, { once: true });
  const startTimer = setTimeout(stop, LIVE_START_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(relayUrl(base(), "live", name), { cache: "no-store", signal: upstream.signal });
  } catch {
    clearTimeout(startTimer);
    clientGone.removeEventListener("abort", stop);
    return { ok: false, status: clientGone.aborted ? 499 : 504, error: CAMERA_ERRORS.noLive };
  }
  clearTimeout(startTimer);

  const contentType = response.headers.get("content-type");
  if (!response.ok || !response.body || !isMjpegStream(contentType)) {
    // An empty 200 is go2rtc's way of saying the camera could not be reached,
    // or that the stream has no MJPEG picture to give.
    stop();
    clientGone.removeEventListener("abort", stop);
    return { ok: false, status: 502, error: CAMERA_ERRORS.noLive };
  }

  const reader = response.body.getReader();
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(lifetime);
    clientGone.removeEventListener("abort", stop);
    stop();
    reader.cancel().catch(() => {});
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      lifetime = setTimeout(() => {
        finish();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }, LIVE_MAX_MS);
    },
    // Pulled, not pushed: the relay is read only as fast as the phone takes
    // it, and go2rtc drops frames for a slow viewer rather than queueing them.
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done || finished) {
          finish();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch {
        finish();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
    cancel() {
      finish();
    },
  });

  return { ok: true, body, contentType: contentType ?? "multipart/x-mixed-replace" };
}
