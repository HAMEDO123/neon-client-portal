import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { avatarColor, avatarSvg, avatarUrl, initialsOf } from "../src/lib/avatar";

describe("initials", () => {
  it("takes the first and last word, as WhatsApp does", () => {
    assert.equal(initialsOf("Hamed Samir"), "HS");
    assert.equal(initialsOf("Abu Omar Nasser"), "AN");
  });

  it("uses one letter for one name", () => {
    assert.equal(initialsOf("Wael"), "W");
    assert.equal(initialsOf("Manager"), "M");
  });

  it("ignores stray spaces and case", () => {
    assert.equal(initialsOf("  sally   jones "), "SJ");
  });

  it("still draws something for no name at all", () => {
    assert.equal(initialsOf(""), "?");
    assert.equal(initialsOf("   "), "?");
  });

  it("keeps a whole letter, not half of one", () => {
    // An emoji is two code units; slicing by index would split it.
    assert.equal(Array.from(initialsOf("🙂 Team")).length, 2);
  });
});

describe("the picture", () => {
  it("colours each person as the board does, and the manager in ink", () => {
    assert.equal(avatarColor("purple"), "#7c3aed");
    assert.equal(avatarColor("ink"), "#15131f");
    assert.equal(avatarColor("not-a-colour"), "#15131f");
    assert.equal(avatarColor(null), "#15131f");
  });

  it("writes the initials into the image", () => {
    const svg = avatarSvg("Hamed Samir", "cyan");
    assert.match(svg, /^<svg /);
    assert.match(svg, />HS<\/text>/);
    assert.match(svg, /fill="#0891b2"/);
  });

  it("cannot be made to carry markup through a name", () => {
    const svg = avatarSvg("<b> x", "cyan");
    assert.equal(svg.includes("<b>"), false);
    assert.match(svg, /&lt;X/);
  });

  it("is fetched from a stable address for the same person", () => {
    assert.equal(avatarUrl("Hamed Samir", "cyan"), "/api/avatar?name=Hamed+Samir&color=cyan");
    assert.equal(avatarUrl("Manager"), "/api/avatar?name=Manager&color=ink");
  });
});
