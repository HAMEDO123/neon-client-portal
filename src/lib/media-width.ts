// The widths /api/media resizes to. A requested width is rounded up to the
// next of these, so a phone asking for 391px and one asking for 414px share
// one cached copy — and nobody can make the server encode a thousand sizes.
export const MEDIA_WIDTHS = [160, 320, 640, 1080, 1600] as const;

/** The width to resize to, or null for the file as it is. */
export function mediaWidth(raw: string | null): number | null {
  if (!raw) return null;
  const asked = Number(raw);
  if (!Number.isFinite(asked) || asked <= 0) return null;
  for (const width of MEDIA_WIDTHS) {
    if (asked <= width) return width;
  }
  return null; // wider than the largest: the original is the right answer
}
