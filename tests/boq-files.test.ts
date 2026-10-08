import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BOQ_FILE_CATEGORY, boqFileTitle, boqFilesOf, hasBoq } from "../src/lib/boq-files";
import { DOCUMENT_CATEGORIES } from "../src/lib/constants";

// A bill of quantities that already exists as a file. It is a document filed
// under "BOQ" rather than a record of its own, and everything below is what
// that choice has to keep true.

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");

describe("a BOQ file", () => {
  // The Documents tab offers this category in its own dropdown. Were the two
  // spelled differently, a file added on one tab would not appear on the other.
  it("is filed under a category the Documents tab already has", () => {
    assert.ok((DOCUMENT_CATEGORIES as readonly string[]).includes(BOQ_FILE_CATEGORY));
  });

  it("is picked out of a project's documents by that category alone", () => {
    const documents = [
      { id: "a", category: "Contracts" },
      { id: "b", category: "BOQ" },
      { id: "c", category: "Pricing" },
      { id: "d", category: "BOQ" },
    ];
    assert.deepEqual(
      boqFilesOf(documents).map((d) => d.id),
      ["b", "d"]
    );
    assert.deepEqual(boqFilesOf([]), []);
  });
});

describe("whether a project has a BOQ to show", () => {
  const item = { id: "i" };
  const file = { category: "BOQ" };
  const contract = { category: "Contracts" };

  // The client's page asked only about items, so a project whose whole BOQ was
  // one spreadsheet had no BOQ section for it to appear in.
  it("is yes for a file with no items", () => {
    assert.equal(hasBoq({ boqItems: [], documents: [file] }), true);
  });

  it("is yes for items, with or without a file", () => {
    assert.equal(hasBoq({ boqItems: [item], documents: [] }), true);
    assert.equal(hasBoq({ boqItems: [item], documents: [file] }), true);
  });

  it("is no when the only documents are something else", () => {
    assert.equal(hasBoq({ boqItems: [], documents: [contract] }), false);
    assert.equal(hasBoq({ boqItems: [], documents: [] }), false);
  });
});

describe("what a BOQ file is called", () => {
  it("is what was typed", () => {
    assert.equal(boqFileTitle("  BOQ — final  ", "export (3).xlsx"), "BOQ — final");
  });

  // A BOQ file is usually already called what it is, in whatever language.
  it("is the file's own name without its extension when nothing was typed", () => {
    assert.equal(boqFileTitle("", "Villa Al-Fulan BOQ rev2.xlsx"), "Villa Al-Fulan BOQ rev2");
    assert.equal(boqFileTitle(null, "جدول الكميات.pdf"), "جدول الكميات");
    assert.equal(boqFileTitle("   ", "boq.final.v3.xls"), "boq.final.v3");
  });

  it("is never empty", () => {
    assert.equal(boqFileTitle("", ""), "Bill of quantities");
    assert.equal(boqFileTitle(undefined, undefined), "Bill of quantities");
    assert.equal(boqFileTitle("", ".xlsx"), "Bill of quantities");
  });
});

// The choice only pays off if nothing treats a BOQ file as a second kind of
// record. These read the source, because every one of them would typecheck,
// build and look right until a client opened a page.
describe("a BOQ file is a document everywhere", () => {
  it("is added through the Documents tab's own upload, with the category decided", () => {
    const actions = read("src", "lib", "actions", "boq-actions.ts");
    assert.match(actions, /formData\.set\("category", BOQ_FILE_CATEGORY\)/);
    assert.match(actions, /await createDocument\(projectId, formData\)/);
  });

  // Somebody else's document id must not be deletable from a BOQ tab.
  it("is removed only from its own project, and only if it is a BOQ file", () => {
    assert.match(
      read("src", "lib", "actions", "boq-actions.ts"),
      /document\.findFirst\(\{ where: \{ id, projectId, category: BOQ_FILE_CATEGORY \} \}\)/
    );
  });

  it("shows on the client's page when it is the whole BOQ, with the download rule the documents have", () => {
    const page = read("src", "app", "p", "[token]", "page.tsx");
    assert.match(page, /\{hasBoq\(project\) && \(\s*<BoqSection/);
    assert.match(page, /files=\{boqFilesOf\(project\.documents\)\}/);
    assert.match(page, /allowDownloads=\{project\.allowDownloads\}/);
    // One place decides whether a download is offered, for both sections.
    assert.match(read("src", "components", "client", "boq-section.tsx"), /<DocumentRows/);
    assert.match(read("src", "components", "client", "documents-section.tsx"), /<DocumentRows/);
  });

  it("changes both tabs when it is added or removed on either", () => {
    const documents = read("src", "lib", "actions", "document-actions.ts");
    assert.match(documents, /refreshProject\(projectId, \{ tab: "documents" \}\)/);
    assert.match(documents, /refreshProject\(projectId, \{ tab: "boq" \}\)/);
  });

  // The person adding the file is the only one who can be told in time.
  it("says, where it is added, that the client sees the file as it is", () => {
    assert.match(read("src", "app", "admin", "(dashboard)", "projects", "[id]", "boq", "page.tsx"), /exactly as it is/);
  });
});
