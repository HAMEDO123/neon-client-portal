import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { acceptableDependencies, waitsForAll, wouldCycle, type Edge } from "../src/lib/task-graph";

// a waits on b, b waits on c.
const chain: Edge[] = [
  { entryId: "a", dependsOnEntryId: "b" },
  { entryId: "b", dependsOnEntryId: "c" },
];

describe("what a task is waiting for", () => {
  it("follows the chain to the end", () => {
    assert.deepEqual([...waitsForAll(chain, "a")].sort(), ["b", "c"]);
    assert.deepEqual([...waitsForAll(chain, "b")], ["c"]);
    assert.deepEqual([...waitsForAll(chain, "c")], []);
  });

  it("does not spin for ever on a loop that already exists", () => {
    const looped: Edge[] = [
      { entryId: "a", dependsOnEntryId: "b" },
      { entryId: "b", dependsOnEntryId: "a" },
    ];
    assert.deepEqual([...waitsForAll(looped, "a")].sort(), ["a", "b"]);
  });
});

describe("refusing a dependency that would close a loop", () => {
  it("refuses a task waiting on itself", () => {
    assert.equal(wouldCycle([], "a", "a"), true);
  });

  it("refuses the other half of a pair", () => {
    // b already waits on c; making c wait on b closes it.
    assert.equal(wouldCycle(chain, "c", "b"), true);
  });

  it("refuses a loop closed through a task in the middle", () => {
    // a waits on b waits on c; c waiting on a would close the ring.
    assert.equal(wouldCycle(chain, "c", "a"), true);
  });

  it("allows two tasks waiting on the same one", () => {
    assert.equal(wouldCycle(chain, "d", "c"), false);
  });

  it("allows a longer chain onto the end", () => {
    assert.equal(wouldCycle(chain, "c", "d"), false);
  });
});

describe("setting a task's whole list at once", () => {
  it("keeps what it can and says what it refused", () => {
    const result = acceptableDependencies(chain, "c", ["d", "a"]);
    assert.deepEqual(result.accepted, ["d"]);
    assert.deepEqual(result.refused, ["a"]);
  });

  it("is not refused by the list it is replacing", () => {
    // a already waits on b; saving the same list again must go through.
    const result = acceptableDependencies(chain, "a", ["b"]);
    assert.deepEqual(result.accepted, ["b"]);
    assert.deepEqual(result.refused, []);
  });

  it("ignores a task named twice", () => {
    const result = acceptableDependencies([], "a", ["b", "b"]);
    assert.deepEqual(result.accepted, ["b"]);
  });

  it("refuses a loop that only the new list would create", () => {
    // Choosing both would make a wait on b, and b already waits on c: fine.
    // But c choosing a and b at once must not close the ring through a.
    const result = acceptableDependencies(chain, "c", ["a", "b"]);
    assert.deepEqual(result.accepted, []);
    assert.deepEqual(result.refused, ["a", "b"]);
  });
});
