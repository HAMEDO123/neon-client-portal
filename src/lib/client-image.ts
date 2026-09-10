// Shrinking a photo on the phone, before it is sent.
//
// An iPhone photo is three to five megabytes, and uploading that over a phone
// connection was most of the wait when sending one. Shrunk to 1600 pixels on
// its long side it is a few hundred kilobytes and looks the same on a screen.
// Drawing it through an <img> also applies the photo's "turn me" tag, so what
// leaves the phone is already upright.
//
// Anything that goes wrong returns the original file untouched: the server
// shrinks and turns whatever it receives, so this is a speed-up, never a
// requirement.

export const MAX_EDGE = 1600;
export const QUALITY = 0.82;

/** The size a photo is drawn at: never larger than it was, long side at most `max`. */
export function fitWithin(width: number, height: number, max = MAX_EDGE) {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function load(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("unreadable"));
    image.src = url;
  });
}

export async function shrinkPhoto(file: File): Promise<File> {
  // GIFs would lose their animation; anything else is not a photo.
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;

  const url = URL.createObjectURL(file);
  try {
    const image = await load(url);
    const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight);
    if (!width || !height) return file;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    // Never send something bigger than what was picked.
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
