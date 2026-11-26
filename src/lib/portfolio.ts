// The studio's public portfolio: one link (/work) a would-be client is sent,
// showing the projects the manager picks. Asked for on 2026-11-25: "url that
// shows our projects that we choose like a portfolio thing, we send it to
// clients to see our works".
//
// It is built from the galleries the projects already have — nothing is
// uploaded twice — and it shows only what was chosen for it: the photos ticked
// `inPortfolio`, under a title written for the public, and the drawings ticked
// the same way (2026-11-26: "لازم نحط مع كل مشروع مخططاته التنفيذية لانه في
// كثير ناس بهمهم"). The client's name, phone, prices and documents never reach
// it; the queries in `portfolio-store.ts` do not even read them.
//
// This file is the pure half; the database half is `portfolio-store.ts`.

export const PORTFOLIO_PATH = "/work";

/** The studio's WhatsApp number for the portfolio's "talk to us" button (AppSetting). */
export const PORTFOLIO_CONTACT_KEY = "portfolio_whatsapp";

/**
 * What the public filters the work by. A fixed list rather than free text, so
 * "Cafe", "café" and "Coffee shop" are one button and not three. The labels
 * are English keys with Arabic in lib/client-i18n.tsx.
 */
export const PORTFOLIO_CATEGORIES = [
  { value: "residential", label: "Residential" },
  { value: "hospitality", label: "Cafés & restaurants" },
  { value: "offices", label: "Offices" },
  { value: "commercial", label: "Commercial" },
] as const;

export type PortfolioCategory = (typeof PORTFOLIO_CATEGORIES)[number]["value"];

/** A category the list knows, or null for anything else. */
export function categoryOf(value: string | null | undefined): PortfolioCategory | null {
  return PORTFOLIO_CATEGORIES.find((category) => category.value === value)?.value ?? null;
}

export function categoryLabel(value: PortfolioCategory | null) {
  return PORTFOLIO_CATEGORIES.find((category) => category.value === value)?.label ?? null;
}

/** The categories the shown projects actually use, in the list's order. */
export function categoriesIn(projects: { category: PortfolioCategory | null }[]) {
  const used = new Set(projects.map((project) => project.category));
  return PORTFOLIO_CATEGORIES.filter((category) => used.has(category.value));
}

export type PortfolioPhoto = { id: string; url: string; caption: string | null };

/**
 * A drawing on the portfolio: a picture shown in the viewer, or a PDF opened in
 * the browser's own. `label` is what the studio typed for the public, or null —
 * never the drawing's own name, which is often the client's ("فيلا السيد
 * النابلسي"), so it is not even read.
 */
export type PortfolioDrawing = { id: string; label: string | null; url: string; kind: "image" | "pdf" };

/**
 * How a drawing can be shown in a browser, or null when it cannot. An AutoCAD
 * file (.dwg) is not shown: a stranger cannot open one, and the studio uploads
 * a PDF of it for that.
 */
export function drawingKind(fileType: string | null | undefined, url = ""): PortfolioDrawing["kind"] | null {
  const type = (fileType || url.split("?")[0].split(".").pop() || "").toLowerCase().replace(/^\./, "");
  if (type === "pdf" || type === "application/pdf") return "pdf";
  if (/^(image\/)?(jpe?g|png|webp|gif)$/.test(type)) return "image";
  return null;
}

export type PortfolioProject = {
  id: string;
  title: string;
  category: PortfolioCategory | null;
  place: string | null;
  area: string | null;
  note: string | null;
  cover: string;
  /**
   * Every ticked photo, room after room — but not the rooms' names. A room is
   * named for the studio's own use ("villa zaareer", the client's name; "التعديل
   * 1", a revision), so the names are not even read (2026-11-25).
   */
  photos: PortfolioPhoto[];
  photoCount: number;
  /** The drawings ticked for the portfolio that a browser can show, in the project's order. */
  drawings: PortfolioDrawing[];
  watermark: boolean;
};

/** How many photos a project shows when none were ticked by hand. */
export const AUTO_PHOTOS = 12;

/**
 * What a word in a project's kind or name says it is — read for the category
 * and the public title of a project published straight onto the portfolio
 * (2026-11-25: "as i upload new projects it should appear automatically … when
 * i press the publish button"). The word found is never shown; its English
 * title is, so a project named after its client says "Villa", not the name.
 */
const KINDS: { words: RegExp; category: PortfolioCategory; title: string }[] = [
  { words: /caf[eé]|coffee|كافي|كوفي|مقهى|قهوة/i, category: "hospitality", title: "Café" },
  { words: /restaurant|bistro|bakery|مطعم|مخبز/i, category: "hospitality", title: "Restaurant" },
  { words: /dental|clinic|عيادة|طبي/i, category: "commercial", title: "Clinic" },
  { words: /beauty|salon|saloon|spa\b|صالون|تجميل/i, category: "commercial", title: "Salon" },
  { words: /shop|store|showroom|boutique|retail|محل|معرض|متجر/i, category: "commercial", title: "Shop" },
  { words: /office|workspace|company|مكتب|مكاتب|شركة/i, category: "offices", title: "Office" },
  { words: /villa|فيلا|فلة/i, category: "residential", title: "Villa" },
  { words: /apartment|flat|شقة/i, category: "residential", title: "Apartment" },
  { words: /bedroom|غرفة نوم/i, category: "residential", title: "Bedroom" },
  { words: /house|home|residence|room|منزل|بيت|غرفة|قصر/i, category: "residential", title: "Residence" },
];

const GENERIC_KIND = /^\s*interior(\s+design(ing)?)?(\s+project)?\s*$/i;

/**
 * The portfolio's first guess at a newly published project: a category, a
 * place and a title — each only a starting point the manager can change.
 *
 * - The category and the title come from words in the kind of project or its
 *   name, never from the name itself.
 * - A kind that says something ("Dental clinic") is the title; "Interior
 *   design" says nothing, so the word found in the name is, and failing that
 *   "Interior project".
 * - The place is the first part of the project's location ("Amman, North JU"
 *   is "Amman"), so a street or a building does not reach the public.
 */
export function firstGuess(project: { name: string; projectType: string | null; location: string | null }) {
  const kind = clean(project.projectType);
  const said = `${kind ?? ""} ${project.name}`;
  const found = KINDS.find((entry) => entry.words.test(said)) ?? null;
  const place = placeOf(project.location);
  const what = kind && !GENERIC_KIND.test(kind) ? capitalised(kind) : (found?.title ?? "Interior project");
  return {
    category: found?.category ?? null,
    place,
    title: place ? `${what} — ${place}` : what,
  };
}

/** The first part of a location, written as a place: "AMMAN" and "salt" are Amman and Salt. */
export function placeOf(location: string | null) {
  const first = clean((location ?? "").split(/[,،\-–—/(]/)[0]);
  if (!first) return null;
  const words = first.slice(0, 40);
  return /^[a-z\s.']+$/i.test(words) && (words === words.toUpperCase() || words === words.toLowerCase())
    ? words.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
    : words;
}

function capitalised(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The photos shown when none were ticked: up to `most`, taken a room at a
 * time — the first of each room, then the second of each — so they range over
 * the whole project rather than filling up from its first room. Being worked
 * out on every read, photos uploaded after publishing join in by themselves.
 */
export function autoPick<T>(rooms: T[][], most = AUTO_PHOTOS) {
  const picked: T[] = [];
  for (let round = 0; picked.length < most && rooms.some((room) => room.length > round); round++) {
    for (const room of rooms) {
      if (room.length > round && picked.length < most) picked.push(room[round]);
    }
  }
  return picked;
}

/** A project as the store reads it: only the fields the public may see. */
export type PortfolioRow = {
  id: string;
  portfolioTitle: string | null;
  portfolioNote: string | null;
  portfolioCoverId: string | null;
  portfolioCategory: string | null;
  portfolioPlace: string | null;
  projectType: string | null;
  area: string | null;
  watermarkEnabled: boolean;
  spaces: { images: { id: string; imageUrl: string; caption: string | null; inPortfolio: boolean }[] }[];
  /** Only the ticked ones are read (portfolio-store.ts). */
  drawings: { id: string; fileUrl: string; fileType: string; portfolioLabel: string | null }[];
};

const clean = (text: string | null | undefined) => {
  const trimmed = (text ?? "").trim();
  return trimmed ? trimmed : null;
};

/**
 * The project as the public sees it, or null when it has nothing to show.
 *
 * **There is no fallback to the project's own name.** The studio names a
 * project after its client ("فيلا السيد النابلسي"), and that is exactly what a
 * stranger must not be shown — so without a public title it is the kind of
 * project, and without that, "Interior project".
 */
export function toPortfolioProject(row: PortfolioRow): PortfolioProject | null {
  // The ones ticked by hand, or — with none ticked — a choice made here.
  const ticked = row.spaces.map((space) => space.images.filter((image) => image.inPortfolio));
  const chosen = ticked.some((room) => room.length > 0) ? ticked.flat() : autoPick(row.spaces.map((space) => space.images));
  const photos = chosen.map((image) => ({ id: image.id, url: image.imageUrl, caption: clean(image.caption) }));
  if (photos.length === 0) return null;

  return {
    id: row.id,
    title: clean(row.portfolioTitle) ?? clean(row.projectType) ?? "Interior project",
    category: categoryOf(row.portfolioCategory),
    place: clean(row.portfolioPlace),
    area: areaOf(row.area),
    note: clean(row.portfolioNote),
    cover: coverOf(photos, row.portfolioCoverId).url,
    photos,
    photoCount: photos.length,
    drawings: row.drawings.flatMap((drawing) => {
      const kind = drawingKind(drawing.fileType, drawing.fileUrl);
      return kind ? [{ id: drawing.id, label: clean(drawing.portfolioLabel), url: drawing.fileUrl, kind }] : [];
    }),
    watermark: row.watermarkEnabled,
  };
}

/** The area as written, with square metres added to a bare number ("350" is 350 m²). */
export function areaOf(area: string | null) {
  const text = clean(area);
  return text && /^\d+(\.\d+)?$/.test(text) ? `${text} m²` : text;
}

/**
 * How a project's photos are laid out on a project's page: rows of one wide photo
 * and then two side by side, again and again. A photo that would sit alone in
 * a row of two takes the whole row instead. True means wide.
 */
export function wideAt(count: number) {
  return Array.from({ length: count }, (_, index) => index % 3 === 0 || (index === count - 1 && index % 3 === 1));
}

/** The chosen cover when it is still one of the shown photos, the first one otherwise. */
export function coverOf(photos: PortfolioPhoto[], coverId: string | null) {
  return photos.find((photo) => photo.id === coverId) ?? photos[0];
}

/**
 * A wa.me link to the studio, or null with no usable number. wa.me wants the
 * country code and digits only; a Jordanian number written the local way
 * (07…) is given its 962.
 */
export function whatsappLink(number: string | null | undefined, text?: string) {
  let digits = (number ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^07\d{8}$/.test(digits)) digits = `962${digits.slice(1)}`;
  if (digits.length < 9) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/**
 * The order after moving one project a place up (-1) or down (+1): the ids in
 * their new order, the list unchanged when it cannot move.
 */
export function moved(ids: string[], id: string, direction: -1 | 1) {
  const from = ids.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
