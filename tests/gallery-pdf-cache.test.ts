import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cachedPdf, inParallel, pdfCacheKey } from "../src/lib/gallery-pdf-cache";

// The gallery PDF made once and kept, and its renders fetched several at a time
// (2026-11-25: a client's phone waited up to 90 seconds per press, and every
// press made the document again).

describe("fetching the renders several at a time", () => {
  it("keeps the gallery's order and never runs more than it is allowed", async () => {
    let running = 0;
    let most = 0;
    const out = await inParallel([5, 1, 4, 2, 3], 2, async (n) => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, n * 3));
      running--;
      return n * 10;
    });
    assert.deepEqual(out, [50, 10, 40, 20, 30]);
    assert.equal(most, 2);
    assert.deepEqual(await inParallel([], 4, async (n: number) => n), []);
  });
});

describe("a finished gallery PDF", () => {
  it("is made once, however many presses arrive together, and read back after", async () => {
    const key = pdfCacheKey({ test: "gallery-pdf-cache", at: process.hrtime.bigint().toString() });
    let made = 0;
    const build = async () => {
      made++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Uint8Array([1, 2, 3]);
    };
    const together = await Promise.all([cachedPdf(key, build), cachedPdf(key, build), cachedPdf(key, build)]);
    assert.equal(made, 1);
    assert.deepEqual([...together[2]], [1, 2, 3]);
    assert.deepEqual([...(await cachedPdf(key, build))], [1, 2, 3]);
    assert.equal(made, 1, "the second press reads the kept copy");
  });
  it("is a new document whenever anything printed changes", () => {
    assert.notEqual(pdfCacheKey({ day: "25 Nov", photos: ["a"] }), pdfCacheKey({ day: "25 Nov", photos: ["a", "b"] }));
    assert.equal(pdfCacheKey({ day: "25 Nov", photos: ["a"] }), pdfCacheKey({ day: "25 Nov", photos: ["a"] }));
    const builder = readFileSync(join(process.cwd(), "src", "lib", "gallery-pdf.ts"), "utf8");
    assert.match(builder, /day: formatDate\(new Date\(\)\),\n\s+watermark,/);
  });
  it("is fetched by the client's page, which says it is being prepared", () => {
    const section = readFileSync(join(process.cwd(), "src", "components", "client", "gallery-section.tsx"), "utf8");
    assert.match(section, /<GalleryPdfButton href=\{`\/p\/\$\{token\}\/gallery\.pdf`\} \/>/);
  });
});
