import sharp from "sharp";
import { readStoredFile } from "@/lib/storage";
import { mediaWidth } from "@/lib/media-width";

// A stored file (a render, a chat photo, a story), served from the platform's
// own address instead of R2's public r2.dev one, which some networks cannot
// reach. See readStoredFile: only this bucket's files, nothing else.
//
// No session is asked for, on purpose: these objects are public already at
// their unguessable r2.dev address, and an image view cannot attach a bearer
// token. What this adds is a way to reach them, not a way to find them.
// Ranges are passed through, so a phone can stream a story's video.
//
// `w` asks for a picture no wider than that, snapped to a few sizes
// (lib/media-width.ts). A gallery grid on a phone showed thirty-odd 2400px
// renders at once — seconds each over the tunnel, and enough decoded pixels
// to get the app killed for memory. A thumbnail is a few dozen kilobytes.

export const dynamic = "force-dynamic";

const IMMUTABLE = "public, max-age=31536000, immutable";

// Resized copies, newest last, so the same thumbnail is not re-encoded for
// every phone that opens the same gallery. Bounded by bytes, not entries.
const resized = new Map<string, Buffer>();
let resizedBytes = 0;
const RESIZED_LIMIT = 96 * 1024 * 1024;

function remember(key: string, value: Buffer) {
  resized.set(key, value);
  resizedBytes += value.length;
  for (const [oldKey, old] of resized) {
    if (resizedBytes <= RESIZED_LIMIT) break;
    resized.delete(oldKey);
    resizedBytes -= old.length;
  }
}

function jpeg(body: Buffer) {
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      "cache-control": IMMUTABLE,
      "content-type": "image/jpeg",
      "content-length": String(body.length),
    },
  });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const url = params.get("u");
  if (!url) return new Response("Missing file.", { status: 400 });

  const width = mediaWidth(params.get("w"));
  const range = request.headers.get("range");

  if (width && !range) {
    const key = `${width}:${url}`;
    const hit = resized.get(key);
    if (hit) {
      // Touch it, so the least recently used goes first.
      resized.delete(key);
      resized.set(key, hit);
      return jpeg(hit);
    }
    const file = await readStoredFile(url, null);
    if (!file) return new Response("Not found.", { status: 404 });
    if (file.contentType?.startsWith("image/")) {
      try {
        const original = Buffer.from(await new Response(file.body).arrayBuffer());
        const small = await sharp(original)
          .rotate()
          .resize({ width, withoutEnlargement: true })
          .jpeg({ quality: 78, mozjpeg: true })
          .toBuffer();
        remember(key, small);
        return jpeg(small);
      } catch {
        // Not something sharp can read: fall through to the file as it is.
      }
    } else {
      // A video or a document asked for with a width: the width means nothing.
      await file.body.cancel().catch(() => {});
    }
  }

  const file = await readStoredFile(url, range);
  if (!file) return new Response("Not found.", { status: 404 });

  const headers = new Headers({
    // Keys are content-unique (a UUID per upload), so a file never changes
    // under the same address and can be cached for good — by the phone and
    // by Cloudflare in front of the tunnel.
    "cache-control": IMMUTABLE,
    "accept-ranges": "bytes",
  });
  if (file.contentType) headers.set("content-type", file.contentType);
  if (file.contentLength !== null) headers.set("content-length", String(file.contentLength));
  if (file.contentRange) headers.set("content-range", file.contentRange);

  return new Response(file.body, { status: file.status, headers });
}
