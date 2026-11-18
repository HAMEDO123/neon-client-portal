// The colourways the whole platform can wear, chosen by the manager in
// Settings (asked for on 2026-11-18: "I want to change the colors", then
// "make it something with glossy cards").
//
// One choice for every surface — the team's portal, the admin, the client's
// page — stored as the AppSetting `colourway` and written by the root layout as
// `data-theme` on <html>. The colours themselves live in globals.css, one
// `:root[data-theme="…"]` block per colourway that sets only the `--cw-*`
// source tokens; everything else is derived from those. This module is the one
// list of names both sides agree on, and the one place a saved value is read:
// a test holds the stylesheet to it.
//
// Pure, with no imports, so the root layout, the settings action, the picker
// and the tests can all use it.

export const COLOURWAY_IDS = ["clay", "olive", "navy", "terracotta", "teal", "plum"] as const;

export type ColourwayId = (typeof COLOURWAY_IDS)[number];

/** What the platform wears when nothing has been chosen, or the choice cannot be read. */
export const DEFAULT_COLOURWAY: ColourwayId = "clay";

/** The AppSetting key the choice is kept under. */
export const COLOURWAY_SETTING = "colourway";

/**
 * How each colourway is named in Settings, and the two colours that cannot be
 * read from a stylesheet: `page` is the phone's status-bar colour
 * (<meta name="theme-color"> takes a literal), and `accent` / `ink` draw the
 * picker's swatches. They must equal the `--cw-page`, `--cw-accent` and
 * `--cw-ink` of the colourway's block in globals.css — the test checks it.
 */
export const COLOURWAYS: Record<ColourwayId, { label: string; feel: string; page: string; accent: string; ink: string }> = {
  clay: { label: "Clay", feel: "Warm paper and clay brown", page: "#f6f2ec", accent: "#846342", ink: "#2c2722" },
  olive: { label: "Olive & linen", feel: "Linen and deep olive", page: "#f4f3ec", accent: "#5f6e45", ink: "#22261f" },
  navy: { label: "Navy & brass", feel: "Ivory, navy and brass", page: "#f6f5f1", accent: "#2a4a7a", ink: "#1b2233" },
  terracotta: { label: "Terracotta", feel: "Cream and burnt orange", page: "#faf4ef", accent: "#93503f", ink: "#2e211b" },
  teal: { label: "Graphite & teal", feel: "Cool grey and teal", page: "#f3f4f4", accent: "#2e6b5f", ink: "#1d2124" },
  plum: { label: "Plum & blush", feel: "Blush and plum", page: "#f8f4f4", accent: "#8e4a6b", ink: "#2a1e26" },
};

/** Whether a value — from a form, a request, anywhere — names a colourway. */
export function isColourwayId(value: unknown): value is ColourwayId {
  return typeof value === "string" && (COLOURWAY_IDS as readonly string[]).includes(value);
}

/**
 * The colourway a saved value means.
 *
 * Total: an unset key, an unknown name, a database that did not answer — all
 * mean the default, so the site never renders a name the stylesheet lacks and
 * never blanks over a colour. Case and surrounding spaces are forgiven.
 */
export function readColourway(saved: string | null | undefined): ColourwayId {
  const value = (saved ?? "").trim().toLowerCase();
  return isColourwayId(value) ? value : DEFAULT_COLOURWAY;
}
