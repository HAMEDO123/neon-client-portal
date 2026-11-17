// Which renders go into a PDF the manager downloads (the gallery screen's
// "Choose photos for a PDF"). Pure, so it is tested.

/** The ids asked for, from `?ids=a,b,c`. Empty or missing means every render. */
export function readPicked(raw: string | null | undefined): Set<string> | null {
  const ids = (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[a-z0-9]{1,40}$/i.test(id));
  return ids.length > 0 ? new Set(ids) : null;
}

/**
 * The gallery with only the chosen renders left, in its own order — never the
 * order they were ticked in, so a PDF reads room by room like the gallery does.
 * An id from another project matches nothing.
 */
export function pickedImages<S extends { images: I[] }, I extends { id: string }>(
  spaces: S[],
  picked: Set<string> | null
): S[] {
  if (!picked) return spaces;
  return spaces.map((space) => ({ ...space, images: space.images.filter((image) => picked.has(image.id)) }));
}
