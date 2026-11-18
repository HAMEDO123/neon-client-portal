import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COLOURWAY_IDS,
  COLOURWAY_SETTING,
  COLOURWAYS,
  DEFAULT_COLOURWAY,
  isColourwayId,
  readColourway,
} from "../src/lib/colourway";

// The colourway the whole platform wears, chosen by the manager in Settings —
// asked for on 2026-11-18: "I want to change the colors", then "make it
// something with glossy cards".

const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), "utf8");

describe("reading a saved colourway", () => {
  it("takes each of the six as saved", () => {
    for (const id of COLOURWAY_IDS) assert.equal(readColourway(id), id);
  });

  it("forgives case and spaces, and falls back to clay for anything else", () => {
    assert.equal(readColourway("  Navy "), "navy");
    assert.equal(DEFAULT_COLOURWAY, "clay");
    for (const saved of [null, undefined, "", "purple", "navy;", "<script>"]) {
      assert.equal(readColourway(saved), "clay", String(saved));
    }
  });

  it("refuses anything that is not one of the names", () => {
    assert.equal(isColourwayId("teal"), true);
    for (const value of ["Teal", " teal", 1, null, undefined, {}, ["teal"]]) {
      assert.equal(isColourwayId(value), false, JSON.stringify(value));
    }
  });

  it("has a name and colours for every colourway", () => {
    assert.deepEqual(Object.keys(COLOURWAYS).sort(), [...COLOURWAY_IDS].sort());
    for (const id of COLOURWAY_IDS) {
      for (const key of ["page", "accent", "ink"] as const) {
        assert.match(COLOURWAYS[id][key], /^#[0-9a-f]{6}$/, `${id}.${key}`);
      }
    }
  });
});

describe("where the colourway is read and written", () => {
  it("is read by the root layout on every request, never frozen at build", () => {
    const layout = read("src", "app", "layout.tsx");
    assert.match(layout, /export const dynamic = "force-dynamic";/);
    assert.match(layout, /export async function generateViewport\(\)/);
    assert.match(layout, /data-theme=\{await colourway\(\)\}/);
  });

  it("is not overridden for the portal by a literal status-bar colour", () => {
    assert.doesNotMatch(read("src", "app", "employee", "layout.tsx"), /themeColor\s*:/);
  });

  it("is written by the manager alone, and only as one of the names", () => {
    const actions = read("src", "lib", "actions", "settings-actions.ts");
    const save = actions.slice(actions.indexOf("export async function saveColourway"));
    assert.match(save, /await requireAdmin\(\);/);
    assert.match(save, /if \(!isColourwayId\(id\)\) throw new Refusal/);
    assert.match(save, /revalidatePath\("\/", "layout"\)/);
  });

  it("repaints every open page when it changes", () => {
    const live = read("src", "lib", "realtime.ts");
    assert.match(live, /FROM "AppSetting" WHERE "key" = \$\{COLOURWAY_SETTING\}/);
    assert.equal(COLOURWAY_SETTING, "colourway");
  });
});

describe("the stylesheet's colourways", () => {
  const css = read("src", "app", "globals.css");
  const block = (id: string) => {
    const blocks = [...css.matchAll(new RegExp(String.raw`:root\[data-theme="${id}"\] \{([^}]*)\}`, "g"))];
    assert.equal(blocks.length, 1, `one block for ${id}`);
    return blocks[0][1];
  };
  const token = (body: string, name: string) => body.match(new RegExp(`--cw-${name}: (#[0-9a-f]{6});`))?.[1];

  it("has one block per colourway, agreeing with the list in code", () => {
    for (const id of COLOURWAY_IDS) {
      const body = block(id);
      assert.equal(token(body, "page"), COLOURWAYS[id].page, `${id} page`);
      assert.equal(token(body, "accent"), COLOURWAYS[id].accent, `${id} accent`);
      assert.equal(token(body, "ink"), COLOURWAYS[id].ink, `${id} ink`);
    }
    assert.equal(css.match(/\[data-theme="/g)?.length, COLOURWAY_IDS.length);
  });

  it("wears clay when the attribute is missing", () => {
    assert.match(css, /:root,\r?\n:root\[data-theme="clay"\] \{/);
  });

  it("never pins a page token to a literal colour below :root", () => {
    for (const scope of [".employee-shell", ".employee-signin", ".client-page", ".admin-shell"]) {
      for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        if (!rule[1].includes(scope)) continue;
        assert.doesNotMatch(rule[2], /--(bg|ink|foreground|line|paper|clay|bark|card|rail)[\w-]*:\s*#/, `${scope}: ${rule[1].trim()}`);
      }
    }
  });

  it("keeps the gloss off the properties that trap pop-ups", () => {
    const glass = [...css.matchAll(/(^|\n)\.glass(-strong)?\s*\{([^}]*)\}/g)].map((m) => m[3]).join("\n");
    assert.ok(glass.length > 0);
    assert.doesNotMatch(glass, /backdrop-filter|filter:|transform|position|overflow/);
  });
});
