import { createHash } from "crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "fs/promises";
import os from "os";
import path from "path";

// Finished gallery PDFs, kept on this server so the same document is made once
// (lib/gallery-pdf.ts). On 2026-11-25 a client's phone was waiting 30–90
// seconds for every press of "Download the gallery as PDF", and pressing again
// — the natural answer to a button that seems to do nothing — started the whole
// document over: six in two minutes for one café.
//
// - **The key is everything printed**: the project's words, the cover, every
//   photo's address and caption in order, the watermark, and the day (the cover
//   says when it was prepared). Change any of it and it is a new document; the
//   old one is simply never asked for again.
// - **Two presses at once make one document**: the second waits for the first.
// - **A copy, not a record**: the files live in the system's temporary folder,
//   the newest few are kept, and losing them all costs one slow download.

const DIR = path.join(os.tmpdir(), "neon-gallery-pdf");
const KEEP = 24;

const building = new Map<string, Promise<Uint8Array>>();

export function pdfCacheKey(parts: unknown) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 40);
}

export async function cachedPdf(key: string, build: () => Promise<Uint8Array>): Promise<Uint8Array> {
  const file = path.join(DIR, `${key}.pdf`);
  try {
    return new Uint8Array(await readFile(file));
  } catch {
    // Not made yet, or made and cleared away: make it.
  }

  const running = building.get(key);
  if (running) return running;

  const job = (async () => {
    const bytes = await build();
    try {
      await mkdir(DIR, { recursive: true });
      // Written whole, then moved into place, so a half-written file is never read.
      const partial = `${file}.${process.pid}.${Date.now()}.part`;
      await writeFile(partial, bytes);
      await rename(partial, file);
      void prune();
    } catch (cause) {
      // The document is still good; it just will not be kept.
      console.error("[gallery-pdf] could not keep a copy", cause);
    }
    return bytes;
  })().finally(() => building.delete(key));

  building.set(key, job);
  return job;
}

/** Keep the newest few; the rest are a slow download away from coming back. */
async function prune() {
  try {
    const names = (await readdir(DIR)).filter((name) => name.endsWith(".pdf"));
    if (names.length <= KEEP) return;
    const dated = await Promise.all(
      names.map(async (name) => ({ name, at: (await stat(path.join(DIR, name))).mtimeMs }))
    );
    dated.sort((a, b) => b.at - a.at);
    await Promise.all(dated.slice(KEEP).map((entry) => unlink(path.join(DIR, entry.name)).catch(() => undefined)));
  } catch {
    // A folder that cannot be tidied is not worth a failed download.
  }
}

/** Run `work` over `items` with at most `limit` at a time, keeping the order of the results. */
export async function inParallel<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
