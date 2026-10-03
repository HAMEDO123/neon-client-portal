import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { beginBusy, endBusy, isBusy, onIdle, whileBusy } from "../src/lib/busy";

// What this guards is a race nothing else can see: `router.refresh()` landing
// on top of a server action still in flight cancels it, the server logs
// "Connection closed", and the browser reports "An unexpected response was
// received from the server". Every check we run passes while it happens.

describe("holding the live refresh off", () => {
  it("is idle until something says otherwise", () => {
    assert.equal(isBusy(), false);
  });

  it("counts, so the first of two uploads to finish does not declare it idle", () => {
    beginBusy();
    beginBusy();
    assert.equal(isBusy(), true);

    endBusy();
    assert.equal(isBusy(), true, "one is still running");

    endBusy();
    assert.equal(isBusy(), false);
  });

  it("never goes below idle, so a stray end cannot leave it negative", () => {
    // A negative depth would make the next real upload look like nothing is
    // running, which is the bug this module exists to stop.
    endBusy();
    endBusy();
    assert.equal(isBusy(), false);

    beginBusy();
    assert.equal(isBusy(), true);
    endBusy();
    assert.equal(isBusy(), false);
  });

  it("tells a waiting refresh the moment the last one finishes", () => {
    let woken = 0;
    const stop = onIdle(() => {
      woken += 1;
    });

    beginBusy();
    beginBusy();
    endBusy();
    assert.equal(woken, 0, "not while one is still running");

    endBusy();
    assert.equal(woken, 1);

    stop();
    beginBusy();
    endBusy();
    assert.equal(woken, 1, "and not after it has stopped listening");
  });

  it("releases even when the upload throws", async () => {
    await assert.rejects(
      whileBusy(async () => {
        assert.equal(isBusy(), true);
        throw new Error("the upload failed");
      }),
      /the upload failed/
    );

    // Otherwise one failed upload stops the page refreshing for ever.
    assert.equal(isBusy(), false);
  });

  it("releases when it succeeds, and gives the answer back", async () => {
    const answer = await whileBusy(async () => {
      assert.equal(isBusy(), true);
      return "saved";
    });

    assert.equal(answer, "saved");
    assert.equal(isBusy(), false);
  });
});
