import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bookFilename, bookVisibility, fileKind } from "../src/lib/project-book-pdf";

// The whole project as one PDF for the client (2026-11-25).

const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), "utf8");

describe("what goes into the project PDF", () => {
  it("takes a PDF's own pages, an image as a page, and names anything else", () => {
    assert.equal(fileKind("pdf", "x"), "pdf");
    assert.equal(fileKind("PDF", "x"), "pdf");
    assert.equal(fileKind("jpg", "x"), "image");
    assert.equal(fileKind("", "https://r2/a/plan.png?v=2"), "image");
    assert.equal(fileKind("dwg", "x"), "other");
    assert.equal(fileKind("xlsx", "x"), "other");
  });
  it("shows the client only the money their page shows", () => {
    const none = bookVisibility({ showPricing: false, showDetailedPricing: true, showBoqQuantities: true, showBoqPrices: true });
    assert.deepEqual(none, { prices: false, boqQuantities: true, boqPrices: false, pricingLines: false });
    const all = bookVisibility({ showPricing: true, showDetailedPricing: true, showBoqQuantities: false, showBoqPrices: true });
    assert.deepEqual(all, { prices: true, boqQuantities: false, boqPrices: true, pricingLines: true });
    assert.equal(bookVisibility({ showPricing: true, showDetailedPricing: false, showBoqQuantities: true, showBoqPrices: false }).pricingLines, false);
  });
  it("is named after the project, as the gallery's is", () => {
    assert.equal(bookFilename("Watin Cafe"), "Watin Cafe - Project.pdf");
    assert.equal(bookFilename("فيلا"), "project - Project.pdf");
  });
  it("leaves out a pricing file while pricing is hidden, and opens only where the zip does", () => {
    const book = read("src", "lib", "project-book-pdf.ts");
    assert.match(book, /clientDocuments\(\{ showPricing: project\.showPricing, documents: project\.documents \}\)/);
    const route = read("src", "app", "p", "[token]", "project.pdf", "route.ts");
    assert.match(route, /project\.publishState !== "PUBLISHED" \|\| !project\.allowDownloads/);
  });
  it("sits in the Download Center beside the zip", () => {
    const section = read("src", "components", "client", "handover-section.tsx");
    assert.match(section, /href=\{`\/p\/\$\{token\}\/project\.pdf`\}/);
    assert.match(section, /href=\{`\/p\/\$\{token\}\/handover\.zip`\}/);
  });
});
