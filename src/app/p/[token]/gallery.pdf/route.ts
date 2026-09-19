import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, degrees, type PDFPage, type PDFFont, type RGB } from "pdf-lib";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { formatDate } from "@/lib/format";

// The gallery as one PDF the client can keep or forward — same access rules
// as the handover package: published projects with downloads allowed.

export const dynamic = "force-dynamic";
// Rendering every image can take a while on a large gallery.
export const maxDuration = 60;

// A4 landscape, in points.
const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 40;
// Renders are downscaled before embedding: a 4K original would make a file
// nobody can email.
const MAX_IMAGE_EDGE = 1600;

const INK = rgb(0.08, 0.075, 0.12);
const MUTED = rgb(0.45, 0.45, 0.5);

/**
 * Whether pdf-lib's standard fonts can draw this at all.
 *
 * Helvetica and its siblings are WinAnsi-encoded: Latin-1 and a handful of
 * punctuation, and nothing else. Handed an Arabic letter, `drawText` does not
 * draw a blank or a box — it **throws**, and takes the whole document with it.
 * That is what made this route answer 500 after sixteen seconds: every render
 * in the gallery was fetched, resized and re-encoded, and then one room called
 * "الطابق الاول" threw the lot away.
 */
function isWinAnsi(text: string): boolean {
  return /^[ -~ -ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/.test(
    text
  );
}

/** How many times larger than its printed size rasterised text is rendered. */
const TEXT_SCALE = 4;

const MARKUP_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function toHex(color: RGB) {
  const channel = (value: number) => Math.round(value * 255).toString(16).padStart(2, "0");
  return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}`;
}

/**
 * Text pdf-lib cannot encode, drawn as a picture of itself instead.
 *
 * sharp is libvips, which is pango and harfbuzz underneath — so Arabic comes
 * out **joined and right-to-left**, which is the entire point. Embedding a
 * Unicode font through fontkit would draw the same letters unjoined and in the
 * wrong order: a PDF that builds successfully and is still wrong to anybody who
 * can read it.
 *
 * The text goes in as pango markup, so it is escaped first — a room named
 * "Kitchen & Bar" would otherwise fail to parse and lose its whole line.
 *
 * Returns null rather than throwing when it cannot be done, because the caller
 * has a worse option and a better one and should get to choose.
 */
async function textAsImage(text: string, size: number, color: RGB, bold = false): Promise<Buffer | null> {
  try {
    return await sharp({
      text: {
        text: `<span foreground="${toHex(color)}">${text.replace(/[&<>"']/g, (ch) => MARKUP_ESCAPES[ch])}</span>`,
        // The weight has to be carried across: the Helvetica path draws a room
        // name in bold, and without this every Arabic heading in the document
        // would be lighter than every Latin one beside it.
        font: `sans ${bold ? "Bold " : ""}${size}`,
        // Renders at TEXT_SCALE times the printed size, so the glyphs stay
        // crisp when the page is zoomed or printed.
        dpi: 72 * TEXT_SCALE,
        rgba: true,
      },
    })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * One line of text on a page, drawn whichever way it can be.
 *
 * `y` is the baseline, as it is for drawText, so no caller has to know which of
 * the two paths was taken — drawImage places a bottom edge, and the difference
 * between the two is the descender.
 *
 * Nothing here is allowed to throw. A gallery of ninety renders must not be
 * lost because of one character in a caption.
 */
async function drawLine(
  pdf: PDFDocument,
  page: PDFPage,
  text: string,
  options: { x: number; y: number; size: number; font: PDFFont; color: RGB; bold?: boolean }
) {
  const line = text.trim();
  if (!line) return;

  if (isWinAnsi(line)) {
    page.drawText(line, options);
    return;
  }

  const png = await textAsImage(line, options.size, options.color, options.bold);
  if (png) {
    try {
      const image = await pdf.embedPng(png);
      page.drawImage(image, {
        x: options.x,
        y: options.y - options.size * 0.22,
        width: image.width / TEXT_SCALE,
        height: image.height / TEXT_SCALE,
      });
      return;
    } catch {
      // Fall through to the last resort below.
    }
  }

  // No fonts on this machine, or pango refused the string. Whatever Helvetica
  // can draw is drawn, and a name it can draw nothing of contributes nothing —
  // rather than costing the client their entire gallery.
  const stripped = [...line].filter((ch) => isWinAnsi(ch)).join("").trim();
  if (stripped) page.drawText(stripped, options);
}

async function loadImage(url: string): Promise<Buffer | null> {
  try {
    const raw = url.startsWith("/")
      ? await readFile(path.join(process.cwd(), "public", url))
      : Buffer.from(await (await fetch(url)).arrayBuffer());

    // Everything becomes JPEG: pdf-lib embeds JPEG and PNG only, and the
    // gallery may hold WebP or AVIF.
    return await sharp(raw)
      .rotate()
      .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    // One unreadable image must not cost the client the whole document.
    return null;
  }
}

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  const project = await prisma.project.findUnique({
    where: { token },
    include: {
      spaces: {
        orderBy: { order: "asc" },
        include: { images: { orderBy: { order: "asc" } } },
      },
    },
  });

  if (!project || project.publishState !== "PUBLISHED" || !project.allowDownloads) {
    return NextResponse.json({ error: "This gallery isn't available." }, { status: 404 });
  }

  const spaces = project.spaces.filter((space) => space.images.length > 0);
  if (spaces.length === 0) {
    return NextResponse.json({ error: "This project has no renders yet." }, { status: 404 });
  }

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${project.name} — Design Gallery`);
  pdf.setAuthor("NEON Design & Programming");
  pdf.setSubject(`Design gallery for ${project.clientName}`);
  pdf.setCreationDate(new Date());

  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);

  // --- Cover -----------------------------------------------------------
  const cover = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  cover.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: rgb(0.97, 0.965, 0.98) });
  cover.drawText("NEON", { x: MARGIN, y: PAGE_HEIGHT - 80, size: 34, font: bold, color: INK });
  cover.drawText("Design & Programming", { x: MARGIN + 96, y: PAGE_HEIGHT - 78, size: 12, font: regular, color: MUTED });

  // The project's own name, and the client's: both are theirs to write, so
  // both go through drawLine rather than straight at Helvetica.
  await drawLine(pdf, cover, project.name, { x: MARGIN, y: PAGE_HEIGHT - 190, size: 40, font: bold, color: INK, bold: true });
  cover.drawText("Design Gallery", { x: MARGIN, y: PAGE_HEIGHT - 232, size: 18, font: regular, color: MUTED });

  const coverLines = [
    project.clientName,
    project.location ?? "",
    project.projectType ?? "",
    `Prepared ${formatDate(new Date())}`,
  ].filter(Boolean);

  for (const [index, line] of coverLines.entries()) {
    await drawLine(pdf, cover, line, { x: MARGIN, y: 150 - index * 20, size: 11, font: regular, color: MUTED });
  }

  const totalImages = spaces.reduce((sum, space) => sum + space.images.length, 0);
  cover.drawText(`${totalImages} render${totalImages === 1 ? "" : "s"} · ${spaces.length} space${spaces.length === 1 ? "" : "s"}`, {
    x: PAGE_WIDTH - MARGIN - 200,
    y: 150,
    size: 11,
    font: regular,
    color: MUTED,
  });

  // --- One page per render ---------------------------------------------
  let pageNumber = 1;

  for (const space of spaces) {
    for (const image of space.images) {
      const buffer = await loadImage(image.imageUrl);
      if (!buffer) continue;

      const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      pageNumber++;

      const embedded = await pdf.embedJpg(buffer);

      // Fit inside the margins, leaving room for the caption strip.
      const boxWidth = PAGE_WIDTH - MARGIN * 2;
      const boxHeight = PAGE_HEIGHT - MARGIN * 2 - 46;
      const scale = Math.min(boxWidth / embedded.width, boxHeight / embedded.height);
      const width = embedded.width * scale;
      const height = embedded.height * scale;

      page.drawImage(embedded, {
        x: (PAGE_WIDTH - width) / 2,
        y: PAGE_HEIGHT - MARGIN - height,
        width,
        height,
      });

      // The room's name and the caption are the studio's own words, and in this
      // studio they are often Arabic.
      await drawLine(pdf, page, space.name, { x: MARGIN, y: MARGIN + 16, size: 12, font: bold, color: INK, bold: true });
      if (image.caption) {
        await drawLine(pdf, page, image.caption.slice(0, 120), {
          x: MARGIN,
          y: MARGIN,
          size: 10,
          font: regular,
          color: MUTED,
        });
      }

      page.drawText(`${pageNumber - 1} / ${totalImages}`, {
        x: PAGE_WIDTH - MARGIN - 40,
        y: MARGIN,
        size: 9,
        font: regular,
        color: MUTED,
      });

      // The project's own watermark setting carries into the PDF, so a
      // protected gallery does not become unprotected by downloading it.
      if (project.watermarkEnabled) {
        page.drawText("NEON", {
          x: PAGE_WIDTH / 2 - 120,
          y: PAGE_HEIGHT / 2 - 40,
          size: 80,
          font: bold,
          color: rgb(1, 1, 1),
          opacity: 0.18,
          rotate: degrees(30),
        });
      }
    }
  }

  await logActivity(project.id, "downloaded_gallery_pdf", `${totalImages} renders`);

  const bytes = await pdf.save();
  const filename = `${project.name.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "project"} - Gallery.pdf`;

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
