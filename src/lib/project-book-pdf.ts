import { readFile } from "fs/promises";
import path from "path";
import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import { formatCurrency, formatDate } from "@/lib/format";
import { cachedPdf, inParallel, pdfCacheKey } from "@/lib/gallery-pdf-cache";
import {
  addCover,
  addRenderPages,
  drawLine,
  INK,
  loadImage,
  loadRenders,
  MARGIN,
  MUTED,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  startPdf,
  type GalleryPdfProject,
  type GalleryPdfSpace,
  type PdfFonts,
} from "@/lib/gallery-pdf";
import { clientDocuments } from "@/lib/pricing-files";

// The whole project as one PDF for the client — the renders, the drawings, the
// documents, and the BOQ, materials, furniture and pricing where the project
// has them — beside the zip of every file (2026-11-25: "a button to download a
// PDF file that contains all the gallery and drawings and everything for the
// project … for the client").
//
// - **The client sees what their page shows, no more**: documents through
//   `clientDocuments` (no pricing file while pricing is hidden), prices only
//   with `showPricing`, BOQ rates only with `showBoqPrices` as well, BOQ
//   quantities only with `showBoqQuantities`, pricing lines only with
//   `showDetailedPricing` (the total either way) — the rules of
//   lib/client-payload.ts.
// - **A drawing or document that is a PDF goes in whole**, its own pages copied
//   as they are, so a drawing stays vector and to scale. An image becomes a page
//   of its own. Anything else — an AutoCAD file — cannot be drawn in a PDF, and
//   is named on a last page that sends the client to the zip for it.
// - **Made once and kept** like the gallery's (lib/gallery-pdf-cache.ts).

type Filed = { title: string; category: string; fileUrl: string; fileType: string; version?: string | null };

export type ProjectBookInput = GalleryPdfProject & {
  showPricing: boolean;
  showDetailedPricing: boolean;
  showBoqQuantities: boolean;
  showBoqPrices: boolean;
  spaces: GalleryPdfSpace[];
  drawings: { name: string; category: string; drawingNumber: string | null; revision: string; fileUrl: string; fileType: string }[];
  documents: Filed[];
  boqItems: { category: string; name: string; description: string | null; unit: string; quantity: number; unitPrice: number | null }[];
  materials: { category: string; name: string; brand: string | null; model: string | null; color: string | null; finish: string | null; supplier: string | null; price: number | null }[];
  furniture: { name: string; space: string | null; brand: string | null; model: string | null; dimensions: string | null; quantity: number; price: number | null }[];
  pricingItems: { category: string; label: string; amount: number; isOptional: boolean }[];
};

const IMAGE_TYPES = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "tif", "tiff", "heic"]);

/** How a file goes into the book: its pages, a page of its own, or not at all. */
export function fileKind(fileType: string, fileUrl: string): "pdf" | "image" | "other" {
  const type = (fileType || fileUrl.split("?")[0].split(".").pop() || "").toLowerCase().replace(/^\./, "");
  if (type === "pdf") return "pdf";
  if (IMAGE_TYPES.has(type)) return "image";
  return "other";
}

/** What the client is shown of the money, by the project's switches. */
export function bookVisibility(project: Pick<ProjectBookInput, "showPricing" | "showDetailedPricing" | "showBoqQuantities" | "showBoqPrices">) {
  return {
    prices: project.showPricing,
    boqQuantities: project.showBoqQuantities,
    boqPrices: project.showPricing && project.showBoqPrices,
    pricingLines: project.showPricing && project.showDetailedPricing,
  };
}

export function bookFilename(name: string) {
  return `${name.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "project"} - Project.pdf`;
}

/** The book, or null when the project has nothing at all to put in it. */
export async function buildProjectBook(project: ProjectBookInput): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const spaces = project.spaces.filter((space) => space.images.length > 0);
  const documents = clientDocuments({ showPricing: project.showPricing, documents: project.documents });
  const seen = bookVisibility(project);
  const pricing = seen.prices ? project.pricingItems : [];
  if (
    spaces.length + project.drawings.length + documents.length + project.boqItems.length + project.materials.length + project.furniture.length + pricing.length ===
    0
  ) {
    return null;
  }

  const key = pdfCacheKey({
    v: 1,
    kind: "project-book",
    day: formatDate(new Date()),
    seen,
    watermark: project.watermarkEnabled,
    project: [project.name, project.clientName, project.location, project.projectType, project.coverImageUrl],
    spaces: spaces.map((space) => [space.name, space.images.map((image) => [image.imageUrl, image.caption])]),
    drawings: project.drawings.map((d) => [d.name, d.category, d.drawingNumber, d.revision, d.fileUrl, d.fileType]),
    documents: documents.map((d) => [d.title, d.category, d.fileUrl, d.fileType, d.version]),
    boq: project.boqItems,
    materials: project.materials,
    furniture: project.furniture,
    pricing,
  });
  const bytes = await cachedPdf(key, () => renderBook(project, spaces, documents, pricing));
  return { bytes, filename: bookFilename(project.name) };
}

async function fetchFile(url: string): Promise<Uint8Array | null> {
  try {
    if (url.startsWith("/")) return new Uint8Array(await readFile(path.join(process.cwd(), "public", url)));
    const response = await fetch(url);
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

type Entry = { title: string; detail: string; fileUrl: string; fileType: string };

async function renderBook(
  project: ProjectBookInput,
  spaces: GalleryPdfSpace[],
  documents: Filed[],
  pricing: ProjectBookInput["pricingItems"]
): Promise<Uint8Array> {
  const seen = bookVisibility(project);
  const totalImages = spaces.reduce((sum, space) => sum + space.images.length, 0);
  const drawings: Entry[] = project.drawings.map((d) => ({
    title: d.name,
    detail: [d.category, d.drawingNumber, d.revision].filter(Boolean).join(" · "),
    fileUrl: d.fileUrl,
    fileType: d.fileType,
  }));
  const docs: Entry[] = documents.map((d) => ({
    title: d.title,
    detail: [d.category, d.version].filter(Boolean).join(" · "),
    fileUrl: d.fileUrl,
    fileType: d.fileType,
  }));

  // Everything fetched first, several at a time, then laid out in order.
  const [renders, drawingFiles, documentFiles] = await Promise.all([
    loadRenders(spaces),
    inParallel(drawings, 4, (entry) => loadEntry(entry)),
    inParallel(docs, 4, (entry) => loadEntry(entry)),
  ]);

  const { pdf, fonts } = await startPdf(`${project.name} — Project`, `The project file for ${project.clientName}`);
  const scope = [
    totalImages && `${totalImages} render${totalImages === 1 ? "" : "s"}`,
    drawings.length && `${drawings.length} drawing${drawings.length === 1 ? "" : "s"}`,
    docs.length && `${docs.length} document${docs.length === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");
  await addCover(pdf, fonts, project, {
    backdropUrl: project.coverImageUrl ?? spaces[0]?.images[0]?.imageUrl ?? null,
    subtitle: "Project File",
    scope: scope || "Project file",
  });

  const missing: Entry[] = [];

  if (spaces.length > 0) {
    await addDivider(pdf, fonts, "Renders", `${totalImages} render${totalImages === 1 ? "" : "s"} · ${spaces.length} space${spaces.length === 1 ? "" : "s"}`);
    await addRenderPages(pdf, fonts, spaces, renders, project.watermarkEnabled, totalImages);
  }
  if (drawings.length > 0) {
    await addDivider(pdf, fonts, "Drawings", `${drawings.length} drawing${drawings.length === 1 ? "" : "s"}`);
    await addFiles(pdf, fonts, drawings, drawingFiles, missing);
  }
  if (docs.length > 0) {
    await addDivider(pdf, fonts, "Documents", `${docs.length} document${docs.length === 1 ? "" : "s"}`);
    await addFiles(pdf, fonts, docs, documentFiles, missing);
  }

  if (project.boqItems.length > 0) {
    const columns: Column[] = [
      { label: "Category", width: 120 },
      { label: "Item", width: 170 },
      { label: "Description", width: seen.boqPrices ? 190 : 300 },
      { label: "Unit", width: 50 },
    ];
    if (seen.boqQuantities) columns.push({ label: "Qty", width: 50, right: true });
    if (seen.boqPrices) columns.push({ label: "Rate", width: 90, right: true }, { label: "Total", width: 90, right: true });
    const rows = project.boqItems.map((item) => {
      const row = [item.category, item.name, item.description ?? "", item.unit];
      if (seen.boqQuantities) row.push(String(item.quantity));
      if (seen.boqPrices) {
        row.push(item.unitPrice == null ? "" : formatCurrency(item.unitPrice));
        row.push(item.unitPrice == null ? "" : formatCurrency(item.unitPrice * item.quantity));
      }
      return row;
    });
    await addTable(pdf, fonts, "Bill of Quantities", columns, rows);
  }

  if (project.materials.length > 0) {
    const columns: Column[] = [
      { label: "Category", width: 110 },
      { label: "Material", width: 170 },
      { label: "Brand / model", width: 150 },
      { label: "Colour / finish", width: 140 },
      { label: "Supplier", width: seen.prices ? 110 : 190 },
    ];
    if (seen.prices) columns.push({ label: "Price", width: 80, right: true });
    const rows = project.materials.map((m) => {
      const row = [m.category, m.name, joined(m.brand, m.model), joined(m.color, m.finish), m.supplier ?? ""];
      if (seen.prices) row.push(m.price == null ? "" : formatCurrency(m.price));
      return row;
    });
    await addTable(pdf, fonts, "Materials", columns, rows);
  }

  if (project.furniture.length > 0) {
    const columns: Column[] = [
      { label: "Item", width: 170 },
      { label: "Space", width: 120 },
      { label: "Brand / model", width: 150 },
      { label: "Dimensions", width: 130 },
      { label: "Qty", width: 50, right: true },
    ];
    if (seen.prices) columns.push({ label: "Price", width: 90, right: true });
    const rows = project.furniture.map((f) => {
      const row = [f.name, f.space ?? "", joined(f.brand, f.model), f.dimensions ?? "", String(f.quantity)];
      if (seen.prices) row.push(f.price == null ? "" : formatCurrency(f.price));
      return row;
    });
    await addTable(pdf, fonts, "Furniture", columns, rows);
  }

  if (pricing.length > 0) {
    const total = pricing.reduce((sum, item) => sum + (item.isOptional ? 0 : item.amount), 0);
    const optional = pricing.reduce((sum, item) => sum + (item.isOptional ? item.amount : 0), 0);
    const rows = seen.pricingLines
      ? pricing.map((item) => [item.category, item.isOptional ? `${item.label} (optional)` : item.label, formatCurrency(item.amount)])
      : [];
    rows.push(["", "Total", formatCurrency(total)]);
    if (optional > 0) rows.push(["", "Optional items", formatCurrency(optional)]);
    await addTable(pdf, fonts, "Pricing", [{ label: "Category", width: 200 }, { label: "Item", width: 382 }, { label: "Amount", width: 180, right: true }], rows);
  }

  if (missing.length > 0) await addMissing(pdf, fonts, missing);
  return pdf.save();
}

type Loaded = { kind: "pdf"; doc: PDFDocument } | { kind: "image"; jpg: Buffer } | null;

async function loadEntry(entry: Entry): Promise<Loaded> {
  const kind = fileKind(entry.fileType, entry.fileUrl);
  if (kind === "other") return null;
  if (kind === "image") {
    const jpg = await loadImage(entry.fileUrl);
    return jpg ? { kind: "image", jpg } : null;
  }
  const bytes = await fetchFile(entry.fileUrl);
  if (!bytes) return null;
  try {
    return { kind: "pdf", doc: await PDFDocument.load(bytes, { ignoreEncryption: true }) };
  } catch {
    return null;
  }
}

async function addFiles(pdf: PDFDocument, fonts: PdfFonts, entries: Entry[], loaded: Loaded[], missing: Entry[]) {
  for (const [index, entry] of entries.entries()) {
    const file = loaded[index];
    if (!file) {
      missing.push(entry);
      continue;
    }
    if (file.kind === "pdf") {
      try {
        const pages = await pdf.copyPages(file.doc, file.doc.getPageIndices());
        for (const page of pages) pdf.addPage(page);
      } catch {
        missing.push(entry);
      }
      continue;
    }
    // An image is laid out as a render is: fitted inside the margins, its name beneath.
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const embedded = await pdf.embedJpg(file.jpg);
    const boxWidth = PAGE_WIDTH - MARGIN * 2;
    const boxHeight = PAGE_HEIGHT - MARGIN * 2 - 46;
    const scale = Math.min(boxWidth / embedded.width, boxHeight / embedded.height);
    page.drawImage(embedded, {
      x: (PAGE_WIDTH - embedded.width * scale) / 2,
      y: PAGE_HEIGHT - MARGIN - embedded.height * scale,
      width: embedded.width * scale,
      height: embedded.height * scale,
    });
    await drawLine(pdf, page, entry.title, { x: MARGIN, y: MARGIN + 16, size: 12, font: fonts.bold, color: INK, bold: true });
    if (entry.detail) await drawLine(pdf, page, entry.detail, { x: MARGIN, y: MARGIN, size: 10, font: fonts.regular, color: MUTED });
  }
}

const RULE = rgb(0.86, 0.85, 0.83);
const SHADE = rgb(0.965, 0.96, 0.95);

/** A page that opens a section: its name large, and what is in it. */
async function addDivider(pdf: PDFDocument, fonts: PdfFonts, title: string, detail: string) {
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: SHADE });
  page.drawText("NEON", { x: MARGIN + 8, y: PAGE_HEIGHT - MARGIN - 20, size: 12, font: fonts.bold, color: MUTED });
  page.drawRectangle({ x: MARGIN + 8, y: PAGE_HEIGHT / 2 + 54, width: 40, height: 2, color: INK });
  await drawLine(pdf, page, title, { x: MARGIN + 8, y: PAGE_HEIGHT / 2, size: 40, font: fonts.bold, color: INK, bold: true });
  await drawLine(pdf, page, detail, { x: MARGIN + 8, y: PAGE_HEIGHT / 2 - 30, size: 13, font: fonts.regular, color: MUTED });
}

type Column = { label: string; width: number; right?: boolean };

/** Cut a cell to its column, by the font's own widths where it can measure them. */
function fit(text: string, width: number, size: number, measure: (text: string) => number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  try {
    if (measure(clean) <= width) return clean;
    let cut = clean;
    while (cut.length > 1 && measure(`${cut}…`) > width) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
  } catch {
    // Not WinAnsi (Arabic): drawn as an image by drawLine, so estimated by length.
    const most = Math.max(4, Math.floor(width / (size * 0.55)));
    return clean.length > most ? `${clean.slice(0, most - 1)}…` : clean;
  }
}

/** A table across as many pages as it needs, its header on every one. */
async function addTable(pdf: PDFDocument, fonts: PdfFonts, title: string, columns: Column[], rows: string[][], reserveBottom = 0) {
  const size = 9.5;
  const rowHeight = 20;
  const left = MARGIN;
  const scale = (PAGE_WIDTH - MARGIN * 2) / columns.reduce((sum, column) => sum + column.width, 0);
  const widths = columns.map((column) => column.width * scale);
  const xs = widths.map((_, index) => left + widths.slice(0, index).reduce((sum, w) => sum + w, 0));

  let page: PDFPage | null = null;
  let y = 0;
  let part = 0;

  const newPage = async () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    part++;
    await drawLine(pdf, page, part === 1 ? title : `${title} (continued)`, {
      x: left,
      y: PAGE_HEIGHT - MARGIN - 18,
      size: 18,
      font: fonts.bold,
      color: INK,
      bold: true,
    });
    y = PAGE_HEIGHT - MARGIN - 52;
    page.drawRectangle({ x: left, y: y - 6, width: PAGE_WIDTH - MARGIN * 2, height: rowHeight, color: SHADE });
    for (const [index, column] of columns.entries()) {
      const label = column.label.toUpperCase();
      const width = fonts.bold.widthOfTextAtSize(label, 8);
      page.drawText(label, { x: column.right ? xs[index] + widths[index] - 6 - width : xs[index] + 6, y, size: 8, font: fonts.bold, color: MUTED });
    }
    y -= rowHeight;
  };

  await newPage();
  for (const row of rows) {
    if (y < MARGIN + 10 + reserveBottom) await newPage();
    const current = page as unknown as PDFPage;
    for (const [index, column] of columns.entries()) {
      const room = widths[index] - 12;
      const text = fit(row[index] ?? "", room, size, (value) => fonts.regular.widthOfTextAtSize(value, size));
      if (!text) continue;
      let x = xs[index] + 6;
      if (column.right) {
        try {
          x = xs[index] + widths[index] - 6 - fonts.regular.widthOfTextAtSize(text, size);
        } catch {
          // Arabic in a number column: left-aligned is the honest fallback.
        }
      }
      await drawLine(pdf, current, text, { x, y, size, font: fonts.regular, color: INK });
    }
    current.drawRectangle({ x: left, y: y - 7, width: PAGE_WIDTH - MARGIN * 2, height: 0.5, color: RULE });
    y -= rowHeight;
  }
}

/** The files a PDF cannot hold, named, and where to find them. */
async function addMissing(pdf: PDFDocument, fonts: PdfFonts, missing: Entry[]) {
  const rows = missing.map((entry) => [entry.title, entry.detail, (fileKind(entry.fileType, entry.fileUrl) === "other" ? entry.fileType : "unreadable").toUpperCase()]);
  await addTable(pdf, fonts, "In the complete package, not in this PDF", [{ label: "File", width: 300 }, { label: "Details", width: 340 }, { label: "Type", width: 120 }], rows, 34);
  const page = pdf.getPages().at(-1);
  if (page) {
    page.drawText("These files cannot be shown inside a PDF (AutoCAD drawings, for example).", { x: MARGIN, y: MARGIN + 14, size: 9.5, font: fonts.regular, color: MUTED });
    page.drawText('Download "Complete Project Package" from your project page to get them.', { x: MARGIN, y: MARGIN, size: 9.5, font: fonts.regular, color: MUTED });
  }
}

function joined(...parts: (string | null)[]) {
  return parts.filter((part) => part && part.trim()).join(" · ");
}
