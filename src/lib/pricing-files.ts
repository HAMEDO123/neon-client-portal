// The price as a file: a quotation, an offer, a priced spreadsheet.
//
// The Pricing tab took line items one at a time and nothing else. The owner
// asked to add the file itself, as the BOQ tab already can (lib/boq-files.ts),
// and it is the same answer: **a pricing file is a `Document` whose category
// is "Pricing"**, not a table of its own, so it shows on the Pricing tab and
// under Documents and everything that already handles a document handles it.
//
// One thing is different from a BOQ file, and it is the reason this module is
// more than a category name: **pricing has a switch.** `showPricing` off means
// the client is not shown what the work costs — and a quotation is exactly
// that. A document is otherwise always the client's to open, so every path a
// client can reach a document by goes through `clientDocuments` here: their
// page, their app's payload, the download link and the handover zip. Hidden by
// leaving it out, never by asking a screen not to draw it.
//
// Pure, and tested.

/** The document category a pricing file is filed under. One of DOCUMENT_CATEGORIES. */
export const PRICING_FILE_CATEGORY = "Pricing";

type Filed = { category: string };

export function pricingFilesOf<T extends Filed>(documents: T[]): T[] {
  return documents.filter((document) => document.category === PRICING_FILE_CATEGORY);
}

/** Whether a client may be handed this one document. */
export function clientMaySee(document: Filed, project: { showPricing: boolean }) {
  return project.showPricing || document.category !== PRICING_FILE_CATEGORY;
}

/** A project's documents as its client gets them: pricing files only while pricing is shown. */
export function clientDocuments<T extends Filed>(project: { showPricing: boolean; documents: T[] }): T[] {
  return project.documents.filter((document) => clientMaySee(document, project));
}

/**
 * Whether the client's page has a pricing section at all — line items, a
 * file, or both, and only while pricing is shown. It asked only about line
 * items, so a project priced by one PDF would have had nowhere to show it.
 */
export function hasPricing(project: { showPricing: boolean; pricingItems: unknown[]; documents: Filed[] }): boolean {
  if (!project.showPricing) return false;
  return project.pricingItems.length > 0 || pricingFilesOf(project.documents).length > 0;
}

/** What a pricing file is called when nobody typed a title: the file's own name. */
export function pricingFileTitle(typed: string | null | undefined, fileName: string | null | undefined): string {
  const title = typed?.trim();
  if (title) return title.slice(0, 200);
  const stem = (fileName ?? "").trim().replace(/\.[A-Za-z0-9]{1,8}$/, "").trim();
  return (stem || "Quotation").slice(0, 200);
}
