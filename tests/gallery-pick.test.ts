import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pickedImages, readPicked } from "../src/lib/gallery-pick";

// A PDF of only the photos chosen — asked for on 2026-11-17:
// "بدي خيار انزل مجموعة صور معينة مش كلهم".

const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), "utf8");

const spaces = [
  { name: "Living", images: [{ id: "a1" }, { id: "a2" }, { id: "a3" }] },
  { name: "Kitchen", images: [{ id: "b1" }] },
];

describe("choosing photos for a PDF", () => {
  it("reads the ids asked for, and nothing that is not an id", () => {
    assert.deepEqual([...(readPicked("a3, a1,,../x,b1") ?? [])], ["a3", "a1", "b1"]);
    assert.equal(readPicked(""), null);
    assert.equal(readPicked(null), null);
  });

  it("keeps the gallery's own order, room by room, whatever order they were ticked in", () => {
    const out = pickedImages(spaces, new Set(["a3", "a1"]));
    assert.deepEqual(
      out.map((space) => space.images.map((image) => image.id)),
      [["a1", "a3"], []]
    );
  });

  it("takes everything when nothing is chosen, and nothing from another project", () => {
    assert.equal(pickedImages(spaces, null), spaces);
    assert.deepEqual(
      pickedImages(spaces, new Set(["elsewhere"])).flatMap((space) => space.images),
      []
    );
  });

  it("is the manager's own route, and the client's page still prints the lot", () => {
    const admin = read("src", "app", "admin", "(dashboard)", "projects", "[id]", "gallery.pdf", "route.ts");
    assert.match(admin, /if \(!\(await hasAdminSession\(\)\)\) return new NextResponse\("Not found", \{ status: 404 \}\)/);
    assert.match(admin, /buildGalleryPdf\(project, pickedImages\(project\.spaces, picked\)/);
    const client = read("src", "app", "p", "[token]", "gallery.pdf", "route.ts");
    assert.match(client, /project\.publishState !== "PUBLISHED" \|\| !project\.allowDownloads/);
    assert.match(client, /buildGalleryPdf\(project, project\.spaces\)/);
  });
});
