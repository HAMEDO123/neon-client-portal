import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { keysInMessages } from "../src/lib/faces";
import { squareImage } from "../src/lib/storage";

// Two things a profile picture depends on that nothing else would catch: the
// keys a screenful of messages asks for, and the shape of what is stored. Get
// either wrong and the platform looks exactly as it did before — initials
// everywhere — with no error anywhere to say why.

describe("whose faces a screenful of messages wants", () => {
  it("asks for the manager by the key they are known by, never by an id", () => {
    const keys = keysInMessages([{ authorType: "ADMIN", authorId: null }]);
    assert.deepEqual(keys, ["admin"]);
  });

  it("asks for an employee author by their own id", () => {
    const keys = keysInMessages([{ authorType: "EMPLOYEE", authorId: "emp-1" }]);
    assert.deepEqual(keys, ["emp-1"]);
  });

  it("reaches into a task card and a meeting card, whose people never wrote anything", () => {
    const keys = keysInMessages([
      {
        authorType: "ADMIN",
        authorId: null,
        task: { assignments: [{ employeeId: "emp-1" }, { employeeId: "emp-2" }] },
      },
      {
        authorType: "EMPLOYEE",
        authorId: "emp-3",
        meeting: { attendees: [{ memberKey: "admin" }, { memberKey: "emp-4" }] },
      },
    ]);

    assert.deepEqual(keys, ["admin", "emp-1", "emp-2", "emp-3", "admin", "emp-4"]);
  });

  it("drops an author with no id rather than asking for the empty string", () => {
    // A message from nobody would otherwise put "" in the query, which matches
    // no row and costs a lookup on every render.
    const keys = keysInMessages([{ authorType: "EMPLOYEE", authorId: null }]);
    assert.deepEqual(keys, []);
  });
});

describe("what a face is stored as", () => {
  it("crops to a square, whatever shape it arrived in", async () => {
    const wide = await sharp({ create: { width: 1200, height: 400, channels: 3, background: "#0891b2" } })
      .jpeg()
      .toBuffer();

    const { buffer, ext } = await squareImage(wide);
    const stored = await sharp(buffer).metadata();

    assert.equal(stored.width, stored.height);
    assert.equal(ext, "jpg");
  });

  it("is small enough to draw a 28px circle with, not a render", async () => {
    // The ordinary image rule fits inside 2400px. A chat row would fetch that
    // for a thumbnail, once per person on the screen.
    const big = await sharp({ create: { width: 3000, height: 3000, channels: 3, background: "#7c3aed" } })
      .jpeg()
      .toBuffer();

    const { buffer } = await squareImage(big);
    const stored = await sharp(buffer).metadata();

    assert.equal(stored.width, 512);
    assert.ok(buffer.length < big.length, "a stored face is smaller than what was sent");
  });

  it("turns a sideways phone photo before it takes the middle of it", async () => {
    // Cropping the middle of pixels that still need turning takes the middle
    // of the wrong rectangle — a face becomes an ear.
    const sideways = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#db2777" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const { buffer } = await squareImage(sideways);
    const stored = await sharp(buffer).metadata();

    assert.equal(stored.width, 512);
    assert.equal(stored.height, 512);
    // The tag is gone, so nothing downstream turns it a second time.
    assert.ok(stored.orientation === undefined || stored.orientation === 1);
  });
});
