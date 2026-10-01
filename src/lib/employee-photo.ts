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

  // `application/octet-stream` is allowed for the same reason storage.ts
  // allows it: a phone that cannot name what it just handed over is not
  // sending a document, and sharp is about to say whether it is a picture
  // rather more reliably than a type string would.
  if (!upload.type.startsWith("image/") && upload.type !== "application/octet-stream") {
    throw new Error("A profile picture has to be a photo.");
  }

  // Cropped to the middle square at 512px before it is stored, because the
  // circle it is drawn in is never more than about a hundred across and the
  // ordinary image rule would keep 2400.
  let squared: Awaited<ReturnType<typeof squareImage>>;
  try {
    squared = await squareImage(Buffer.from(await upload.arrayBuffer()));
  } catch {
    // Says what to do, not what broke. Somebody on a phone can act on the
    // first and not on the second.
    throw new Error("That file could not be read as a photo. Try taking one with the camera.");
  }
  const saved = await saveFile(
    new File([new Uint8Array(squared.buffer)], "face.jpg", { type: "image/jpeg" }),
    `avatars/${employeeId}`,
    "image",
    // Already squared and re-encoded — compressing again would only cost time.
    false
  );

  return saved.url;
}
