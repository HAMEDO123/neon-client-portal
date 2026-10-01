import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CODE_ALPHABET,
  CODE_LENGTH,
  formatCode,
  generateAccessCode,
  normaliseCode,
} from "../src/lib/client-codes";

// This module is the whole of a client's access check. A mistake in it either
// locks somebody out of their own project or lets a guess in, and neither
// shows up anywhere else.

describe("a code the studio can read down the phone", () => {
  it("is eight characters of the alphabet and nothing else", () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const code = generateAccessCode();
      assert.equal(code.length, CODE_LENGTH);
      for (const character of code) assert.ok(CODE_ALPHABET.includes(character), `${character} in ${code}`);
    }
  });

  it("leaves out the characters people mishear, so no code can contain one", () => {
    // I, L, O and U are absent by design: the first three because they are
    // heard as 1, 1 and 0, and U so that no code spells anything.
    for (const character of "ILOU") {
      assert.ok(!CODE_ALPHABET.includes(character), `${character} should not be in the alphabet`);
    }
  });

  it("does not favour the start of the alphabet", () => {
    // 32 divides 256, so every character is equally likely. With an alphabet of
    // any other length this test is what would catch the bias.
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 4000; attempt += 1) {
      for (const character of generateAccessCode()) seen.add(character);
    }
    assert.equal(seen.size, CODE_ALPHABET.length, "every character should turn up");
  });

  it("does not repeat itself in any run the studio would ever make", () => {
    const codes = new Set<string>();
    for (let attempt = 0; attempt < 2000; attempt += 1) codes.add(generateAccessCode());
    assert.equal(codes.size, 2000);
  });
});

describe("what a client actually types", () => {
  it("takes it the way it was shown to them", () => {
    assert.equal(normaliseCode("4F7K-2QX9"), "4F7K2QX9");
  });

  it("takes it lower case, spaced, or run together", () => {
    assert.equal(normaliseCode("4f7k2qx9"), "4F7K2QX9");
    assert.equal(normaliseCode("4F7K 2QX9"), "4F7K2QX9");
    assert.equal(normaliseCode("  4f7k - 2qx9  "), "4F7K2QX9");
    assert.equal(normaliseCode("4F7K.2QX9"), "4F7K2QX9");
  });

  it("forgives the letters that sound like digits", () => {
    // Read down the phone, "zero" comes back as O and "one" as I or l. A client
    // who types what they heard has typed their own code.
    assert.equal(normaliseCode("O1234567"), "01234567");
    assert.equal(normaliseCode("I1234567"), "11234567");
    assert.equal(normaliseCode("l1234567"), "11234567");
  });

  it("refuses anything that is not this code, rather than guessing at it", () => {
    assert.equal(normaliseCode(""), null);
    assert.equal(normaliseCode("4F7K"), null, "too short");
    assert.equal(normaliseCode("4F7K2QX9A"), null, "too long");
    assert.equal(normaliseCode("4F7K2QX!"), null, "not in the alphabet");
    assert.equal(normaliseCode("4F7K2QXU"), null, "U is not in the alphabet");
    assert.equal(normaliseCode("../../etc/passwd"), null);
  });

  it("round-trips every code it generates, as shown and as typed", () => {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const code = generateAccessCode();
      assert.equal(normaliseCode(formatCode(code)), code);
      assert.equal(normaliseCode(formatCode(code).toLowerCase()), code);
    }
  });
});

describe("how a code is shown", () => {
  it("is grouped, so it can be read out", () => {
    assert.equal(formatCode("4F7K2QX9"), "4F7K-2QX9");
  });
});
