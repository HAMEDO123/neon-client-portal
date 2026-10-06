import { needsTranscode, playableVoice } from "@/lib/voice-transcode";
import { whatsAppMessageMedia, type WhatsAppResult } from "@/lib/whatsapp/worker";
import { AttachmentCache, attachmentName, baseType, contentDisposition, readRange } from "@/lib/whatsapp-media";

// One WhatsApp attachment, ready to hand to a browser or the phone app.
//
// The two media routes — the website's and the app's — differ in how they
// refuse somebody, and in nothing else. What they hand over is decided here,
// once: the bytes from the worker, **a voice note converted so an iPhone can
// play it**, a name the system can open the file by, and an answer to `Range`
// so a player will play it at all (see lib/whatsapp-media.ts for why each of
// those is not optional).
//
// **The guard is the caller's, and it runs first, every time.** Nothing here
// checks who is asking; the short keep below is only ever reached by a route
// that has already decided the person may read the studio's messages.

export type Attachment = { bytes: Uint8Array; mimeType: string; filename: string };

const kept = new AttachmentCache<Attachment>();
/** A file being fetched right now: a player's three requests share one fetch. */
const fetching = new Map<string, Promise<WhatsAppResult<Attachment>>>();

/**
 * WhatsApp's voice notes are Ogg Opus, which an iPhone will not play — not in
 * Safari, not in the app's player, not in Quick Look. So audio that would not
 * play everywhere becomes AAC in an .m4a, the same conversion a voice note
 * shared into a team chat already gets. Without ffmpeg the file is handed over
 * as it came: never lost to the conversion, only as unplayable as it was.
 */
async function playable(bytes: Uint8Array, mimeType: string, filename: string | null): Promise<Attachment> {
  if (baseType(mimeType).startsWith("audio/") && needsTranscode(mimeType)) {
    const original = new File([bytes as BlobPart], attachmentName(mimeType, filename), { type: baseType(mimeType) });
    const { file } = await playableVoice(original);
    if (file !== original) {
      return {
        bytes: new Uint8Array(await file.arrayBuffer()),
        mimeType: file.type,
        filename: attachmentName(file.type, file.name),
      };
    }
  }
  return { bytes, mimeType: mimeType || "application/octet-stream", filename: attachmentName(mimeType, filename) };
}

async function fetchAttachment(messageId: string): Promise<WhatsAppResult<Attachment>> {
  const result = await whatsAppMessageMedia(messageId);
  if (!result.ok) return result;

  const bytes = new Uint8Array(Buffer.from(result.data.base64, "base64"));
  const attachment = await playable(bytes, result.data.mimeType, result.data.filename);
  kept.set(messageId, attachment, Date.now());
  return { ok: true, data: attachment };
}

/** The attachment of one message, or the worker's own sentence about why not. */
export function readAttachment(messageId: string): Promise<WhatsAppResult<Attachment>> {
  const held = kept.get(messageId, Date.now());
  if (held) return Promise.resolve({ ok: true, data: held });

  const already = fetching.get(messageId);
  if (already) return already;

  const started = fetchAttachment(messageId).finally(() => fetching.delete(messageId));
  fetching.set(messageId, started);
  return started;
}

/**
 * The response for one attachment: the whole of it, or the part a player asked
 * for.
 *
 * `no-store` because these are somebody's private messages and the guard must
 * run on every request for one — the keep above is ours, inside the process,
 * and a browser's would not be.
 */
export function attachmentResponse(request: Request, attachment: Attachment): Response {
  const size = attachment.bytes.byteLength;
  const headers: Record<string, string> = {
    "content-type": attachment.mimeType,
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
    "content-disposition": contentDisposition(attachment.filename),
  };

  const range = readRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
  }
  if (range) {
    const part = attachment.bytes.subarray(range.start, range.end + 1);
    return new Response(new Uint8Array(part), {
      status: 206,
      headers: {
        ...headers,
        "content-length": String(part.byteLength),
        "content-range": `bytes ${range.start}-${range.end}/${size}`,
      },
    });
  }

  return new Response(new Uint8Array(attachment.bytes), {
    headers: { ...headers, "content-length": String(size) },
  });
}
