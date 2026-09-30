import { saveFile, squareImage } from "@/lib/storage";

// Storing somebody's face, for the manager's action and the person's own.
//
// Deliberately not a `"use server"` module: an export of one of those is a
// public endpoint, and this one takes an employee id — the whole point is that
// each caller has already decided *whose* face it may write, the manager by
// `requireAdmin` and the person by their own session.

/**
 * Reads the upload and answers with the URL to store, or null to remove.
 *
 * An absent or empty file is "take it off", not an error: the same form does
 * both, and a person removing their photo has sent exactly that.
 */
export async function saveEmployeePhoto(
  employeeId: string,
  upload: FormDataEntryValue | null
): Promise<string | null> {
  if (!(upload instanceof File) || upload.size === 0) return null;

  if (!upload.type.startsWith("image/")) {
    throw new Error("A profile picture has to be a photo.");
  }

  // Cropped to the middle square at 512px before it is stored, because the
  // circle it is drawn in is never more than about a hundred across and the
  // ordinary image rule would keep 2400.
  const squared = await squareImage(Buffer.from(await upload.arrayBuffer()));
  const saved = await saveFile(
    new File([new Uint8Array(squared.buffer)], "face.jpg", { type: "image/jpeg" }),
    `avatars/${employeeId}`,
    "image",
    // Already squared and re-encoded — compressing again would only cost time.
    false
  );

  return saved.url;
}
