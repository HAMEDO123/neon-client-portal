// The studio's public portfolio: one link (/work) a would-be client is sent,
// showing the projects the manager picks. Asked for on 2026-11-25: "url that
// shows our projects that we choose like a portfolio thing, we send it to
// clients to see our works".
//
// It is built from the galleries the projects already have — nothing is
// uploaded twice — and it shows only what was chosen for it: the photos ticked
// `inPortfolio`, under a title written for the public. The client's name,
// phone, prices, drawings and documents never reach it; the queries in
// `portfolio-store.ts` do not even read them.
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
export type PortfolioRoom = { name: string; photos: PortfolioPhoto[] };

export type PortfolioProject = {
  id: string;
  title: string;
  category: PortfolioCategory | null;
  place: string | null;
  area: string | null;
  note: string | null;
  cover: string;
  rooms: PortfolioRoom[];
  photoCount: number;
  watermark: boolean;
};

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
  spaces: { name: string; images: { id: string; imageUrl: string; caption: string | null }[] }[];
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
  const rooms = row.spaces
    .map((space) => ({
      name: space.name,
      photos: space.images.map((image) => ({ id: image.id, url: image.imageUrl, caption: clean(image.caption) })),
    }))
    .filter((room) => room.photos.length > 0);
  const photos = rooms.flatMap((room) => room.photos);
  if (photos.length === 0) return null;

  return {
    id: row.id,
    title: clean(row.portfolioTitle) ?? clean(row.projectType) ?? "Interior project",
    category: categoryOf(row.portfolioCategory),
    place: clean(row.portfolioPlace),
    area: areaOf(row.area),
    note: clean(row.portfolioNote),
    cover: coverOf(photos, row.portfolioCoverId).url,
    rooms,
    photoCount: photos.length,
    watermark: row.watermarkEnabled,
  };
}

/** The area as written, with square metres added to a bare number ("350" is 350 m²). */
export function areaOf(area: string | null) {
  const text = clean(area);
  return text && /^\d+(\.\d+)?$/.test(text) ? `${text} m²` : text;
}

/**
 * How a room's photos are laid out on a project's page: rows of one wide photo
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
