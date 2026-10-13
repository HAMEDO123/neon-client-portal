import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PRICING_FILE_CATEGORY,
  clientDocuments,
  clientMaySee,
  hasPricing,
  pricingFileTitle,
  pricingFilesOf,
} from "../src/lib/pricing-files";
import { DOCUMENT_CATEGORIES } from "../src/lib/constants";

// The price as a file. It is a document filed under "Pricing" — and unlike any
// other document, it has to obey the switch that hides pricing from a client.

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");

const quote = { id: "q", category: "Pricing" };
const contract = { id: "c", category: "Contracts" };
const boq = { id: "b", category: "BOQ" };

describe("a pricing file", () => {
  it("is filed under a category the Documents tab already has", () => {
    assert.ok((DOCUMENT_CATEGORIES as readonly string[]).includes(PRICING_FILE_CATEGORY));
    assert.deepEqual(pricingFilesOf([contract, quote, boq]).map((d) => d.id), ["q"]);
  });

  it("is named after the file when nothing was typed, and never empty", () => {
    assert.equal(pricingFileTitle("  Final offer ", "x.pdf"), "Final offer");
    assert.equal(pricingFileTitle("", "عرض سعر فيلا.pdf"), "عرض سعر فيلا");
    assert.equal(pricingFileTitle(null, ""), "Quotation");
  });
});

describe("what a client is handed", () => {
  // A quotation is exactly what "pricing hidden" exists to keep back.
  it("leaves a pricing file out while pricing is hidden, and nothing else", () => {
    const hidden = { showPricing: false, documents: [contract, quote, boq] };
    assert.deepEqual(clientDocuments(hidden).map((d) => d.id), ["c", "b"]);
    assert.equal(clientMaySee(quote, hidden), false);
    assert.equal(clientMaySee(contract, hidden), true);

    const shown = { showPricing: true, documents: [contract, quote, boq] };
    assert.deepEqual(clientDocuments(shown).map((d) => d.id), ["c", "q", "b"]);
    assert.equal(clientMaySee(quote, shown), true);
  });

  it("has a pricing section for a file with no line items, only while pricing is shown", () => {
    assert.equal(hasPricing({ showPricing: true, pricingItems: [], documents: [quote] }), true);
    assert.equal(hasPricing({ showPricing: true, pricingItems: [{}], documents: [] }), true);
    assert.equal(hasPricing({ showPricing: true, pricingItems: [], documents: [contract] }), false);
    assert.equal(hasPricing({ showPricing: false, pricingItems: [{}], documents: [quote] }), false);
  });
});

// Hidden by leaving it out, on every path a client can reach a document by.
// Each of these typechecks, builds and looks right with the filter missing —
// and the file is then one link away from somebody it was hidden from.
describe("the pricing switch reaches every way a client gets a document", () => {
  it("their page", () => {
    const page = read("src", "app", "p", "[token]", "page.tsx");
    assert.match(page, /const documents = clientDocuments\(project\);/);
    assert.match(page, /<DocumentsSection documents=\{documents\}/);
    assert.equal(/<DocumentsSection documents=\{project\.documents\}/.test(page), false);
    assert.match(page, /\{hasPricing\(project\) && \(\s*<PricingSection/);
  });

  it("their app", () => {
    assert.match(read("src", "lib", "client-payload.ts"), /documents: clientDocuments\(project\)\.map\(/);
  });

  it("the download link", () => {
    assert.match(read("src", "app", "p", "[token]", "dl", "[kind]", "[fileId]", "route.ts"), /found && clientMaySee\(found, project\) \? found : null/);
  });

  it("the handover zip", () => {
    assert.match(read("src", "app", "p", "[token]", "handover.zip", "route.ts"), /for \(const doc of clientDocuments\(project\)\)/);
  });
});

describe("a pricing file is a document everywhere", () => {
  const actions = read("src", "lib", "actions", "pricing-actions.ts");

  it("is added through the Documents tab's own upload, with the category decided", () => {
    assert.match(actions, /formData\.set\("category", PRICING_FILE_CATEGORY\)/);
    assert.match(actions, /await createDocument\(projectId, formData\)/);
  });

  it("is removed only from its own project, and only if it is a pricing file", () => {
    assert.match(actions, /document\.findFirst\(\{ where: \{ id, projectId, category: PRICING_FILE_CATEGORY \} \}\)/);
  });

  it("says, where it is added, when the client sees it", () => {
    assert.match(read("src", "app", "admin", "(dashboard)", "projects", "[id]", "pricing", "page.tsx"), /only while “Show Execution Pricing” is on/);
  });
});
