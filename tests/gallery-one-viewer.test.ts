import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The client's gallery runs one photo viewer across every room, so the arrows
// and a swipe go on from one room into the next (2026-11-25).

const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), "utf8");

describe("the client's gallery viewer", () => {
  const section = read("src", "components", "client", "gallery-section.tsx");
  it("is one viewer for every room, opened at the photo's place in the whole gallery", () => {
    assert.equal(section.split("<Lightbox").length - 1, 1);
    assert.match(section, /onOpen=\{\(index\) => setOpen\(startOf\(roomIndex\) \+ index\)\}/);
  });
  it("says which room each photo is in", () => {
    assert.match(section, /caption: image\.caption \? `\$\{space\.name\} · \$\{image\.caption\}` : space\.name/);
  });
  it("leaves a grid given onOpen without a viewer of its own", () => {
    assert.match(read("src", "components", "client", "gallery-grid.tsx"), /\{!onOpen && <Lightbox/);
  });
});
