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

// The cover is the studio's own render with the facts written over it, so its
// palette is the opposite of every other page: paper on near-black.
const PAPER = rgb(0.97, 0.96, 0.94);
const PAPER_DIM = rgb(0.79, 0.78, 0.76);
const COVER_DARK = rgb(0.05, 0.047, 0.055);
const COVER_MARGIN = 48;
/** How tall the band of facts along the foot is. */
const COVER_BAND = 92;

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

/**
 * The cover's backdrop: the project's own picture, darkened enough to write on.
 *
 * **The scrim is composited into the image rather than drawn over it.** pdf-lib
 * has no gradients, and faking one with stacked translucent rectangles bands
 * visibly across a page this size. sharp does it properly, and this route
 * already depends on sharp for every render it embeds.
 *
 * Dark at the top where the mark sits, dark again along the foot where the
 * facts are, and clearest through the middle — so the render is still the thing
 * you see first, which is the point of putting it there.
 */
async function coverBackdrop(url: string | null): Promise<Buffer | null> {
  if (!url) return null;

  try {
    const raw = url.startsWith("/")
      ? await readFile(path.join(process.cwd(), "public", url))
      : Buffer.from(await (await fetch(url)).arrayBuffer());

    // Twice the page size, so the cover stays sharp when it is printed or
    // opened at full screen.
    const width = PAGE_WIDTH * 2;
    const height = PAGE_HEIGHT * 2;

    const scrim = Buffer.from(
      `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
         <defs>
           <linearGradient id="down" x1="0" y1="0" x2="0" y2="1">
             <stop offset="0%" stop-color="#0c0b0e" stop-opacity="0.78"/>
             <stop offset="38%" stop-color="#0c0b0e" stop-opacity="0.34"/>
             <stop offset="72%" stop-color="#0c0b0e" stop-opacity="0.54"/>
             <stop offset="100%" stop-color="#0c0b0e" stop-opacity="0.93"/>
           </linearGradient>
           <linearGradient id="across" x1="0" y1="0" x2="1" y2="0">
             <stop offset="0%" stop-color="#0c0b0e" stop-opacity="0.72"/>
             <stop offset="58%" stop-color="#0c0b0e" stop-opacity="0.10"/>
             <stop offset="100%" stop-color="#0c0b0e" stop-opacity="0.28"/>
           </linearGradient>
         </defs>
         <rect width="100%" height="100%" fill="url(#down)"/>
         <rect width="100%" height="100%" fill="url(#across)"/>
       </svg>`
    );

    return await sharp(raw)
      .rotate()
      .resize({ width, height, fit: "cover", position: "centre" })
      .composite([{ input: scrim }])
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();
  } catch {
    // A cover that cannot be read is not worth losing the gallery over; the
    // page falls back to the flat dark it would have ended up behind anyway.
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
  //
  // The studio's own render, darkened, with the facts written across the foot.
  // A gallery is a thing a client forwards to other people, and this is the
  // page they see before any of the work.
  const totalImages = spaces.reduce((sum, space) => sum + space.images.length, 0);
  const cover = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  // The cover image the studio chose, else the first render. A project that
  // reaches this route always has at least the second.
  const backdrop = await coverBackdrop(project.coverImageUrl ?? spaces[0].images[0].imageUrl);

  if (backdrop) {
    const picture = await pdf.embedJpg(backdrop);
    cover.drawImage(picture, { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT });
  } else {
    // Nothing readable to show. The page still has to work, so it keeps the
    // near-black the scrim would have left behind anyway.
    cover.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: COVER_DARK });
  }

  cover.drawText("NEON", { x: COVER_MARGIN, y: PAGE_HEIGHT - 84, size: 30, font: bold, color: PAPER });
  cover.drawText("Design & Programming", {
    x: COVER_MARGIN,
    y: PAGE_HEIGHT - 106,
    size: 11.5,
    font: regular,
    color: PAPER_DIM,
  });

  // The name is the loudest thing on the page, so it gives way rather than
  // running off it: a project named in a sentence still gets a cover, instead
  // of a line that disappears past the edge.
  const nameSize = project.name.length > 30 ? 30 : project.name.length > 20 ? 40 : 52;
  await drawLine(pdf, cover, project.name, {
    x: COVER_MARGIN,
    y: 268,
    size: nameSize,
    font: bold,
    color: PAPER,
    bold: true,
  });

  // The subtitle says what kind of work this is, in the studio's own words from
  // the project's Details — so the capitalisation on the cover is whatever was
  // typed there, rather than something invented here.
  await drawLine(pdf, cover, project.projectType ? `${project.projectType} Gallery` : "Design Gallery", {
    x: COVER_MARGIN,
    y: 240,
    size: 15,
    font: regular,
    color: PAPER_DIM,
  });

  // --- The facts, along the foot ---------------------------------------
  cover.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: COVER_BAND, color: COVER_DARK, opacity: 0.5 });
  // A hairline drawn as a rectangle: `drawLine` is this file's own text helper,
  // and the page method of the same name beside it would read as a mistake.
  cover.drawRectangle({ x: 0, y: COVER_BAND, width: PAGE_WIDTH, height: 0.75, color: PAPER, opacity: 0.16 });

  const facts = [
    { value: project.clientName, label: "Project Lead" },
    { value: project.location ?? "", label: "Location" },
    { value: project.projectType ?? "", label: "Focus Area" },
    { value: formatDate(new Date()), label: "Prepared" },
    {
      value: `${totalImages} render${totalImages === 1 ? "" : "s"} · ${spaces.length} space${spaces.length === 1 ? "" : "s"}`,
      label: "Scope Summary",
    },
  ].filter((fact) => fact.value.trim());

  // Spread evenly rather than packed to the left, and each fact keeps the same
  // room — so a long location cannot shove the scope off the edge of the page.
  const column = (PAGE_WIDTH - COVER_MARGIN * 2) / Math.max(facts.length, 1);

  for (const [index, fact] of facts.entries()) {
    const x = COVER_MARGIN + index * column;
    // Value above, label beneath, for all five. The design had two of them the
    // other way round; one reading order across the row is easier to take in
    // than a row that changes its mind halfway.
    await drawLine(pdf, cover, fact.value, { x, y: 44, size: 11, font: bold, color: PAPER, bold: true });
    cover.drawText(fact.label, { x, y: 28, size: 8.5, font: regular, color: PAPER_DIM });
  }

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
