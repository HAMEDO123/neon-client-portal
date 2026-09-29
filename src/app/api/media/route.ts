import { readStoredFile } from "@/lib/storage";

// A stored file (a render, a chat photo, a story), served from the platform's
// own address instead of R2's public r2.dev one, which some networks cannot
// reach. See readStoredFile: only this bucket's files, nothing else.
//
// No session is asked for, on purpose: these objects are public already at
// their unguessable r2.dev address, and an image view cannot attach a bearer
// token. What this adds is a way to reach them, not a way to find them.
// Ranges are passed through, so a phone can stream a story's video.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("u");
  if (!url) return new Response("Missing file.", { status: 400 });

  const file = await readStoredFile(url, request.headers.get("range"));
  if (!file) return new Response("Not found.", { status: 404 });

  const headers = new Headers({
    // Keys are content-unique (a UUID per upload), so a file never changes
    // under the same address and can be cached for good — by the phone and
    // by Cloudflare in front of the tunnel.
    "cache-control": "public, max-age=31536000, immutable",
    "accept-ranges": "bytes",
  });
  if (file.contentType) headers.set("content-type", file.contentType);
  if (file.contentLength !== null) headers.set("content-length", String(file.contentLength));
  if (file.contentRange) headers.set("content-range", file.contentRange);

  return new Response(file.body, { status: file.status, headers });
}
