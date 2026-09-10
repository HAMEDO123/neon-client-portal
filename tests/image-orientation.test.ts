import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { compressImage } from "../src/lib/storage";

// How an iPhone stores a portrait photo: the pixels are landscape, and an
// EXIF tag — orientation 6 — says "turn this 90° clockwise to view it".
// Re-encoding drops the tag, so a photo that was not turned first comes out
// on its side, which is what happened to a portrait photo sent in the chat.
async function sideways(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: "#d94f7a" } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

describe("a phone photo is stored upright", () => {
  it("turns a portrait photo the way it was taken", async () => {
    const stored = await sideways(400, 200);
    const before = await sharp(stored).metadata();
    assert.equal(before.orientation, 6);
    assert.equal(before.width, 400);

    const { buffer } = await compressImage(stored);
    const after = await sharp(buffer).metadata();

    // Portrait now, in the pixels themselves — nothing left to misread.
    assert.equal(after.width, 200);
    assert.equal(after.height, 400);
    assert.ok(after.orientation === undefined || after.orientation === 1);
  });

  it("leaves an upright photo as it is", async () => {
    const upright = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#0891b2" } })
      .jpeg()
      .toBuffer();

    const { buffer } = await compressImage(upright);
    const after = await sharp(buffer).metadata();
    assert.equal(after.width, 300);
    assert.equal(after.height, 200);
  });
});
