import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { answerError, RpcError, bool, num, oneOf, optNum, str } from "@/lib/mobile/rpc";

// The phone API's two routes serve everything through the registries in
// lib/mobile/registry. A read there is a page's query reachable over the
// network, so the one rule that matters is the website's own: nothing is read
// before the guard that page is behind. These tests hold every area to it.

const DIR = join(process.cwd(), "src", "lib", "mobile", "registry");
const AREA_FILES = readdirSync(DIR).filter((name) => name.endsWith(".ts") && name !== "index.ts");

/** The top-level entries of one registry object in a file: key → the text after the colon. */
function entries(source: string, registry: "reads" | "actions"): { key: string; body: string }[] {
  const start = source.indexOf(`export const ${registry}`);
  if (start < 0) return [];
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
    if (depth === 0) {
      end = i;
      break;
    }
  }
  const block = source.slice(open + 1, end);
  const found: { key: string; body: string }[] = [];
  const keyPattern = /^ {2}"([^"]+)":\s*([\s\S]*?)(?=^ {2}"[^"]+":|$(?![\s\S]))/gm;
  for (const match of block.matchAll(keyPattern)) found.push({ key: match[1], body: match[2].trim() });
  return found;
}

describe("the phone API registries", () => {
  it("has one file per area, each wired into the index", () => {
    const index = readFileSync(join(DIR, "index.ts"), "utf8");
    for (const file of AREA_FILES) {
      const area = file.replace(/\.ts$/, "");
      assert.ok(index.includes(`@/lib/mobile/registry/${area}"`), `${file} is not imported by registry/index.ts`);
    }
  });

  it("guards every read, and names every key after its area", () => {
    for (const file of AREA_FILES) {
      const area = file.replace(/\.ts$/, "");
      const source = readFileSync(join(DIR, file), "utf8");

      for (const { key, body } of entries(source, "reads")) {
        assert.ok(key.startsWith(`${area}/`), `${file}: read "${key}" must be named "${area}/…"`);
        assert.ok(body.startsWith("guarded("), `${file}: read "${key}" must be written as guarded(<the page's guard>, …)`);
      }
      for (const { key } of entries(source, "actions")) {
        assert.ok(key.startsWith(`${area}/`), `${file}: action "${key}" must be named "${area}/…"`);
      }
    }
  });
});

describe("reading arguments from the phone", () => {
  it("refuses the wrong shapes with a sentence, not a crash", () => {
    assert.equal(str("a"), "a");
    assert.throws(() => str(""), RpcError);
    assert.throws(() => str(3), RpcError);
    assert.equal(num("4.5"), 4.5);
    assert.throws(() => num("x"), RpcError);
    assert.equal(optNum(""), null);
    assert.equal(bool("true"), true);
    assert.equal(bool("no"), false);
    assert.equal(oneOf("DONE", ["TODO", "DONE"] as const), "DONE");
    assert.throws(() => oneOf("NOPE", ["TODO", "DONE"] as const), RpcError);
  });
});

describe("what a thrown error means to the app", () => {
  it("turns the website's redirect after a save into success with the path", async () => {
    const error = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/admin/projects/abc;307;" });
    const response = answerError(error);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, result: null, redirect: "/admin/projects/abc" });
  });

  it("answers a guard's refusal as signed out, and a person-facing refusal as it was written", async () => {
    assert.equal(answerError(new Error("Unauthorized")).status, 401);
    // Signed in, but the guard says no: not a reason to sign the person out.
    assert.equal(answerError(new Error("Unauthorized"), true).status, 403);

    const refused = answerError(new Error("This employee already has 3 warnings. Remove one before giving another."));
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error, /3 warnings/);
  });

  it("does not hand a stack or a query back to the phone", async () => {
    const response = answerError(new Error("Invalid `prisma.project.update()` invocation:\n\nsecret details"));
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error, "Something went wrong. Try again.");
  });
});
