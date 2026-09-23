// What a stored file is, read from its own address.
//
// Proof of finished work used to be a photo and nothing else, so every screen
// that showed one wrote `<img src={submission.imageUrl}>` and was right. It is
// a drawing, a PDF or a spreadsheet now as well — and an `<img>` pointed at a
// PDF draws a broken icon, which reads as "the upload failed" rather than "this
// is a document".
//
// Pure, and in one place, because five screens ask this question and the answer
// has to be the same on all of them.

/** Exactly the image types `saveFile` stores — see lib/storage.ts. */
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "avif"];

const LABELS: Record<string, string> = {
  pdf: "PDF",
  doc: "Word document",
  docx: "Word document",
  xls: "Spreadsheet",
  xlsx: "Spreadsheet",
  csv: "Spreadsheet",
  zip: "ZIP archive",
  rar: "Archive",
  dwg: "Drawing",
  dxf: "Drawing",
  mp4: "Video",
  mov: "Video",
  txt: "Text file",
};

/**
 * The extension of a stored file, lowercase and without the dot.
 *
 * Query strings and fragments are cut off first: a signed URL ending
 * `.pdf?token=…` is still a PDF, and reading the extension off the whole string
 * would find "pdf?token=…" and match nothing.
 */
export function extensionOf(url: string | null | undefined): string {
  if (!url) return "";
  const clean = url.split("?")[0].split("#")[0];
  const at = clean.lastIndexOf(".");
  if (at === -1 || at === clean.length - 1) return "";
  return clean.slice(at + 1).toLowerCase();
}

/**
 * Whether this is something a screen can draw with an `<img>`, and something a
 * model can be asked to look at.
 *
 * Unknown means **not** an image. A file we cannot identify is shown as a file
 * and sent to a person, which is the harmless way round; guessing the other way
 * puts a broken icon on the manager's review screen.
 */
export function isImage(url: string | null | undefined): boolean {
  return IMAGE_EXTENSIONS.includes(extensionOf(url));
}

/** What to call it on screen when it cannot be shown: "PDF", "Spreadsheet". */
export function attachmentLabel(url: string | null | undefined): string {
  const extension = extensionOf(url);
  return LABELS[extension] ?? (extension ? extension.toUpperCase() : "File");
}

/**
 * What a proof picker offers, kept to what `saveFile`'s "document" rule accepts
 * — see lib/storage.ts. A phone greys out everything else in the file list,
 * which is a kinder place to say no than after the upload.
 */
export const PROOF_ACCEPT = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.dwg,.dxf,.mp4";

/**
 * Whether a file just chosen in the browser is a picture: something an `<img>`
 * can draw, and something `shrinkPhoto` can shrink. Everything else goes up
 * untouched — drawing a PDF to a canvas produces a blank image or throws.
 */
export function isPictureFile(file: File): boolean {
  return file.type.startsWith("image/");
}
