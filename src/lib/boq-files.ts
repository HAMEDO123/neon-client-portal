// A bill of quantities that already exists as a file.
//
// The BOQ tab took items one at a time — category, name, unit, quantity — and
// nothing else, which is right for a BOQ being built here and useless for one
// the studio already has as a spreadsheet or a PDF. The owner asked to be able
// to add the file itself.
//
// **A BOQ file is a `Document` whose category is "BOQ"** — a category the
// Documents tab has always offered — and deliberately not a new table. One
// record, so there is nothing to keep in step: the file shows on the BOQ tab
// and under Documents, the client's page already knows how to open and
// download a document, the client's own app already receives it, and the
// handover zip already packs it. A second kind of record would have needed
// every one of those taught about it, and one of them would have been missed.
//
// What follows from that, and is said on the screen where the file is added:
// **the client sees a BOQ file exactly as it is.** The switches that hide
// quantities and prices act on the rows of the items table; nothing can hide a
// column inside somebody's spreadsheet.
//
// Pure, and tested.

/** The document category a BOQ file is filed under. One of DOCUMENT_CATEGORIES. */
export const BOQ_FILE_CATEGORY = "BOQ";

/** The BOQ files among a project's documents, in the order they were given. */
export function boqFilesOf<T extends { category: string }>(documents: T[]): T[] {
  return documents.filter((document) => document.category === BOQ_FILE_CATEGORY);
}

/**
 * Whether a project has a bill of quantities to show at all — as items, as a
 * file, or both. The client's page asked only about items, so a project whose
 * whole BOQ was one spreadsheet would have had no BOQ section to put it in.
 */
export function hasBoq(project: { boqItems: unknown[]; documents: { category: string }[] }): boolean {
  return project.boqItems.length > 0 || boqFilesOf(project.documents).length > 0;
}

/**
 * What a BOQ file is called when nobody typed a title: the file's own name
 * without its extension, which is what the person who made it called it.
 */
export function boqFileTitle(typed: string | null | undefined, fileName: string | null | undefined): string {
  const title = typed?.trim();
  if (title) return title.slice(0, 200);

  const stem = (fileName ?? "").trim().replace(/\.[A-Za-z0-9]{1,8}$/, "").trim();
  return (stem || "Bill of quantities").slice(0, 200);
}
