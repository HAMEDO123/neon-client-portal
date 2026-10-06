// Handing a WhatsApp attachment to a browser or a phone: what it is called,
// which part of it was asked for, and how long a fetched one is kept.
//
// Pure, and tested, because each of the three fails quietly:
//
//   - **A file with no extension cannot be opened.** WhatsApp gives a document
//     its name and gives a photo, a video and a voice note none. The phone app
//     saves what it downloads under the name it is given and hands it to the
//     system, which decides what a file is by its extension — so a voice note
//     called "attachment" is a file nothing will play.
//   - **A player asks for a file in pieces.** Safari will not play an <audio>
//     or a <video> from a server that ignores `Range`; it asks for the first
//     two bytes, and an answer of the whole file with a 200 is read as "this
//     cannot be played". Nothing is logged anywhere when that happens.
//   - **Each piece would otherwise be the whole fetch again** — the worker
//     decrypting the file and, for a voice note, ffmpeg converting it — so one
//     press of play is three of both. Hence the short keep.

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/amr": "amr",
  "audio/wav": "wav",
  "application/pdf": "pdf",
  "text/vcard": "vcf",
  "text/x-vcard": "vcf",
  "text/plain": "txt",
};

/** "audio/ogg; codecs=opus" → "audio/ogg". */
export function baseType(mimeType: string): string {
  return mimeType.split(";")[0].trim().toLowerCase();
}

/**
 * A name the system can open the file by.
 *
 * A name that already ends in an extension is kept exactly — it is the
 * sender's own. Otherwise one is made from what the file is: "photo.jpg",
 * "video.mp4", "voice-note.m4a".
 */
export function attachmentName(mimeType: string, filename: string | null | undefined): string {
  const given = filename?.trim() ?? "";
  if (/\.[A-Za-z0-9]{1,8}$/.test(given)) return given;

  const type = baseType(mimeType);
  const extension = EXTENSIONS[type];
  const stem =
    given || (type.startsWith("image/") ? "photo" : type.startsWith("video/") ? "video" : type.startsWith("audio/") ? "voice-note" : "attachment");
  return extension ? `${stem}.${extension}` : stem;
}

/**
 * The Content-Disposition for a name that may not be ASCII.
 *
 * An Arabic file name in a plain `filename="…"` is not a valid header value —
 * building the response throws — so it goes as RFC 5987 `filename*`, with an
 * ASCII stand-in beside it for anything that reads only the old form.
 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  return `inline; filename="${ascii || "attachment"}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * The part of a file a `Range` header asks for.
 *
 * Null is "the whole file": no header, a unit other than bytes, several ranges
 * at once, or anything malformed — a header we cannot read is ignored, as the
 * standard says, rather than refused. "unsatisfiable" is a well-formed range
 * that starts past the end.
 */
export function readRange(header: string | null | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header || size <= 0) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, from, to] = match;
  if (from === "" && to === "") return null;

  // "bytes=-500": the last five hundred.
  if (from === "") {
    const length = Number(to);
    if (length <= 0) return "unsatisfiable";
    return { start: Math.max(0, size - length), end: size - 1 };
  }

  const start = Number(from);
  if (start >= size) return "unsatisfiable";
  const end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  if (end < start) return null;
  return { start, end };
}

/**
 * Attachments just fetched, kept for the few minutes a player takes to ask for
 * the rest of one.
 *
 * In this process's memory and nowhere else, and never past `ttlMs`: these are
 * somebody's private messages. It is not a way round the guard — the routes
 * check who is asking on every request and only then look here — it only saves
 * decrypting and converting the same file again for the next piece of it.
 */
export class AttachmentCache<T extends { bytes: { byteLength: number } }> {
  private readonly kept = new Map<string, { value: T; at: number }>();
  private total = 0;

  constructor(
    private readonly ttlMs = 5 * 60_000,
    private readonly maxBytes = 96 * 1024 * 1024,
    /** Larger than this is handed over and not kept: one video must not empty the rest. */
    private readonly maxItemBytes = 24 * 1024 * 1024
  ) {}

  get(key: string, now: number): T | null {
    const found = this.kept.get(key);
    if (!found) return null;
    if (now - found.at > this.ttlMs) {
      this.drop(key);
      return null;
    }
    return found.value;
  }

  set(key: string, value: T, now: number): void {
    this.drop(key);
    for (const [other, entry] of this.kept) {
      if (now - entry.at > this.ttlMs) this.drop(other);
    }

    const size = value.bytes.byteLength;
    if (size > this.maxItemBytes) return;

    // Oldest first: a Map keeps the order things were put in.
    for (const other of this.kept.keys()) {
      if (this.total + size <= this.maxBytes) break;
      this.drop(other);
    }

    this.kept.set(key, { value, at: now });
    this.total += size;
  }

  /** How much is held, for the tests. */
  get bytes(): number {
    return this.total;
  }

  private drop(key: string): void {
    const found = this.kept.get(key);
    if (!found) return;
    this.total -= found.value.bytes.byteLength;
    this.kept.delete(key);
  }
}
