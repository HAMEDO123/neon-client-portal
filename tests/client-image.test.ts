import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { fitWithin, MAX_EDGE } from "../src/lib/client-image";

describe("shrinking a photo before it is sent", () => {
  it("brings a 12-megapixel iPhone photo down to the long side limit", () => {
    assert.deepEqual(fitWithin(4032, 3024), { width: MAX_EDGE, height: 1200 });
  });

  it("keeps a portrait photo portrait", () => {
    assert.deepEqual(fitWithin(3024, 4032), { width: 1200, height: MAX_EDGE });
  });

  it("never enlarges a photo that is already small", () => {
    assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
  });

  it("handles a square and a nonsense size", () => {
    assert.deepEqual(fitWithin(3000, 3000), { width: MAX_EDGE, height: MAX_EDGE });
    assert.deepEqual(fitWithin(0, 100), { width: 0, height: 0 });
  });
});
