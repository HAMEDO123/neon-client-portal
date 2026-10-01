import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isSealed, open, seal } from "../src/lib/secret-box";

// What this does and does not protect is written at the top of secret-box.ts.
// These tests pin the part that is checkable: that it round-trips, that a
// changed byte is refused rather than returning rubbish, and that the sealed
// form never contains what was sealed.

process.env.SESSION_SECRET ??= "test-secret-for-the-secret-box-tests";

describe("a secret the platform must read back", () => {
  it("comes back exactly as it went in", () => {
    for (const plain of ["hunter2", "", "a password with spaces", "كلمة السر", "🙂 emoji"]) {
      assert.equal(open(seal(plain)), plain);
    }
  });

  it("never contains what was sealed", () => {
    // The whole point: a database dump must not carry the password.
    const sealed = seal("SuperSecret123");
    assert.ok(!sealed.includes("SuperSecret123"));
    assert.ok(!Buffer.from(sealed).toString("utf8").includes("SuperSecret123"));
  });

  it("is different every time, so two equal passwords do not look equal", () => {
    assert.notEqual(seal("same"), seal("same"));
  });

  it("refuses a value somebody has changed, rather than returning rubbish", () => {
    const sealed = seal("hunter2");
    const parts = sealed.split(".");
    // Flip a character of the body.
    const body = parts[3];
    const flipped = (body[0] === "A" ? "B" : "A") + body.slice(1);
    assert.equal(open([parts[0], parts[1], parts[2], flipped].join(".")), null);
  });

  it("refuses anything that is not ours", () => {
    assert.equal(open(null), null);
    assert.equal(open(undefined), null);
    assert.equal(open(""), null);
    assert.equal(open("hunter2"), null, "a value stored before this existed");
    assert.equal(open("v1.only.three"), null);
    assert.equal(open("v2.a.b.c"), null, "a scheme we do not know");
  });

  it("cannot be opened with a different SESSION_SECRET", () => {
    // Said in the module's comment, and worth a test: rotating the secret makes
    // what is stored unreadable, and the caller must see null rather than throw.
    const sealed = seal("hunter2");
    const was = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "a completely different secret";
    try {
      assert.equal(open(sealed), null);
    } finally {
      process.env.SESSION_SECRET = was;
    }
  });

  it("knows one of its own without opening it", () => {
    assert.equal(isSealed(seal("x")), true);
    assert.equal(isSealed("plain text left over from before"), false);
    assert.equal(isSealed(null), false);
  });
});
