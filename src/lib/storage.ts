import { put, del } from "@vercel/blob";
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import sharp from "sharp";
import { MAX_UPLOAD_BYTES, sizeLabel } from "@/lib/upload-limits";

const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");

type UploadKind = "image" | "document" | "audio";

/**
 * What a drawing or document may be when the browser will not say.
 *
 * Only reached for a file whose type is empty or the generic one — never a way
 * round a type the browser *did* name, so a .exe called .pdf is still refused
 * on its type as it was before.
 */
const DOCUMENT_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "csv",
  "txt",
  "zip",
  "rar",
  "7z",
  "mp4",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "heic",
  "heif",
  // The CAD and model files the studio actually sends, which are the ones
  // Windows has no type for.
  "dwg",
  "dxf",
  "dwf",
  "rvt",
  "rfa",
  "skp",
  "3ds",
  "max",
  "obj",
  "fbx",
  "stl",
  "step",
  "stp",
  "iges",
  "igs",
  "ai",
  "psd",
  "indd",
  "eps",
  "svg",
];

// One number, from lib/upload-limits.ts, which says where it comes from: the
// smaller of Cloudflare's 100 MB and this build's body limit, less what
// multipart wraps around the file. A rule with its own figure would be a second
// place for the limit to drift from the one the browser checks against.
const RULES: Record<UploadKind, { types: string[]; extensions?: string[]; maxBytes: number; label: string }> = {
  image: {
    // HEIC/HEIF is what an iPhone takes by default, and this studio is a
    // phone-first one. A browser cannot draw it, so it is never stored as it
    // arrives — `saveFile` always re-encodes it to JPEG (see ALWAYS_CONVERT).
    // sharp in this image reads HEIF, which is what makes that possible.
    types: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/avif",
      "image/heic",
      "image/heif",
    ],
    // This is checked before compression runs, so it has to cover the raw
    // original — a high-res camera photo or 4K render export easily clears 12MB.
    maxBytes: MAX_UPLOAD_BYTES,
    label: `JPEG, PNG, WebP, GIF, AVIF, or an iPhone photo (max ${sizeLabel(MAX_UPLOAD_BYTES)})`,
  },
  audio: {
    // Voice notes recorded in the browser. Chrome/Android produce webm/ogg,
    // iOS Safari mp4/aac — all of them arrive here.
    types: [
      "audio/webm",
      "audio/ogg",
      "audio/mp4",
      "audio/mpeg",
      "audio/aac",
      "audio/wav",
      "audio/x-m4a",
      "audio/opus", // a WhatsApp voice note shared from the phone
      "video/webm", // MediaRecorder labels an audio-only webm this way
    ],
    maxBytes: 15 * 1024 * 1024,
    label: "a voice recording (max 15MB)",
  },
  document: {
    types: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/zip",
      "application/x-zip-compressed",
      "video/mp4",
      "image/jpeg",
      "image/png",
      "image/webp",
      // An iPhone photo attached as a document, converted below like any other.
      "image/heic",
      "image/heif",
      "application/octet-stream", // DWG and other CAD files report this generic type in most browsers
    ],
    // ...and often no type at all. A browser names a file from what the
    // operating system has registered for its extension, and Windows has
    // nothing for .dwg, .dxf, .rvt or .skp — so `file.type` arrives as the
    // empty string and the list above cannot match it. The extension is what
    // is left to go on; see `allowedDocument`.
    extensions: DOCUMENT_EXTENSIONS,
    maxBytes: MAX_UPLOAD_BYTES,
    label: `PDF, DOCX, XLSX, ZIP, MP4, DWG, or image (max ${sizeLabel(MAX_UPLOAD_BYTES)})`,
  },
};

// Renders and photos over this size are recompressed before storage — keeps the
// gallery fast to load without asking admins to pre-shrink every export manually.
const COMPRESS_THRESHOLD_BYTES = 1 * 1024 * 1024;

/** Formats no browser draws, so they are re-encoded however small they are. */
const ALWAYS_CONVERT = ["image/heic", "image/heif"];
const MAX_DIMENSION = 2400;

export async function compressImage(buffer: Buffer): Promise<{ buffer: Buffer; ext: string }> {
  // Upright first. A phone stores a portrait photo as landscape pixels plus a
  // tag saying "turn me"; re-encoding drops the tag, so unless the pixels are
  // turned first the photo comes out on its side. rotate() with no angle reads
  // the tag and turns the pixels to match it.
  const resized = sharp(buffer).rotate().resize({
    width: MAX_DIMENSION,
    height: MAX_DIMENSION,
    fit: "inside",
    withoutEnlargement: true,
  });

  let quality = 82;
  let output = await resized.clone().jpeg({ quality, mozjpeg: true }).toBuffer();

  while (output.length > COMPRESS_THRESHOLD_BYTES && quality > 40) {
    quality -= 10;
    output = await resized.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
  }

  return { buffer: output, ext: "jpg" };
}

// A face, at the size a face is actually drawn.
//
// The ordinary image rule fits a photo inside 2400px, which is right for a
// render on a client's page and absurd for a circle 28 pixels across: every
// chat row, task card and call tile would fetch a megabyte to draw a thumbnail.
// This crops to the middle square and stores 512px — big enough for the largest
// place one appears (a call tile at 88, a profile at 96 on a retina screen).
const AVATAR_SIZE = 512;

export async function squareImage(buffer: Buffer): Promise<{ buffer: Buffer; ext: string }> {
  // rotate() first for the same reason compressImage does it: a phone's
  // portrait photo is landscape pixels plus a tag, and cropping the middle of
  // the untuned pixels takes the middle of the wrong rectangle.
  const output = await sharp(buffer)
    .rotate()
    .resize({ width: AVATAR_SIZE, height: AVATAR_SIZE, fit: "cover", position: "attention" })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();

  return { buffer: output, ext: "jpg" };
}

/**
 * Whether this file may be stored under this rule.
 *
 * The type first, as it always was. Only when the browser gives none — or the
 * generic one it uses for "I have no idea" — does the extension decide, and
 * only for a rule that lists extensions at all. A .dwg from Windows arrives
 * with `file.type === ""`, which is the whole reason this exists: the upload
 * was refused as an unsupported type when nothing had said what the type was.
 */
function allowed(rule: { types: string[]; extensions?: string[] }, baseType: string, file: File): boolean {
  if (rule.types.includes(baseType)) return true;

  const unnamed = baseType.length === 0 || baseType === "application/octet-stream";
  if (!unnamed || !rule.extensions) return false;

  return rule.extensions.includes(extFromFile(file));
}

function extFromFile(file: File) {
  const name = file.name || "";
  const dot = name.lastIndexOf(".");
  if (dot > -1 && dot < name.length - 1) return name.slice(dot + 1).toLowerCase();
  const sub = file.type.split("/")[1] ?? "bin";
  return sub === "jpeg" ? "jpg" : sub;
}

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
  mp4: "video/mp4",
  webm: "audio/webm",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

// ---------- Cloudflare R2 (S3-compatible) ----------
// Preferred backend when configured: 10GB storage free, no egress fees, ever.
// Falls back to Vercel Blob, then local disk, when unset — see .env for setup.

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl: publicUrl.replace(/\/$/, "") };
}

let r2Client: S3Client | null = null;
function getR2Client(accountId: string, accessKeyId: string, secretAccessKey: string) {
  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return r2Client;
}

/** Whether a photo carries a "turn me" tag rather than being upright already. */
async function needsTurning(buffer: Buffer) {
  try {
    const { orientation } = await sharp(buffer).metadata();
    return typeof orientation === "number" && orientation !== 1;
  } catch {
    return false;
  }
}

export interface SavedFile {
  url: string;
  fileType: string;
  fileSize: number;
}

export async function saveFile(
  file: File,
  folder: string,
  kind: UploadKind = "document",
  compress: boolean = true
): Promise<SavedFile> {
  const rule = RULES[kind];
  // "audio/webm;codecs=opus" is audio/webm: Chrome names its voice notes that
  // way, and matching the whole string rejected every one of them.
  const baseType = file.type.split(";")[0].trim().toLowerCase();
  if (!allowed(rule, baseType, file)) {
    throw new Error(`Unsupported file type. Use: ${rule.label}.`);
  }
  if (file.size > rule.maxBytes) {
    throw new Error(`File is too large. Max size: ${rule.label.match(/max ([^)]+)/)?.[1] ?? "limit"}.`);
  }

  let buffer: Buffer = Buffer.from(await file.arrayBuffer());
  let ext = extFromFile(file);

  // Re-encoded when it is big, and also when it is sideways: a small photo with
  // a "turn me" tag looks right in a browser but not in everything that reads
  // the file afterwards, the gallery PDF for one.
  //
  // **And always for a format a browser cannot draw.** An iPhone photo is HEIC,
  // and a small upright one meets neither condition above — so without this it
  // would be stored exactly as it arrived, with a `.heic` name and no content
  // type we know, and every screen that showed it would show a broken picture
  // instead. The upload would have reported success, which is the worst way for
  // this to go wrong.
  const mustConvert = ALWAYS_CONVERT.includes(baseType);

  // `mustConvert` is not gated on the kind: a HEIC attached to a drawing is as
  // undrawable as one added to the gallery, and the client it is shown to is on
  // whatever computer they have.
  if (mustConvert || (kind === "image" && compress && (buffer.length > COMPRESS_THRESHOLD_BYTES || (await needsTurning(buffer))))) {
    try {
      const compressed = await compressImage(buffer);
      buffer = compressed.buffer;
      ext = compressed.ext;
    } catch (cause) {
      // sharp says "Input buffer contains unsupported image format", which is
      // true and no use to somebody holding a phone. A file that cannot be read
      // as a picture is a file to replace, and that is what the sentence says.
      if (mustConvert) {
        throw new Error("That photo could not be read. Try taking it again, or send it as a JPEG.");
      }
      // Only an optimisation failed, and the original is perfectly good: a
      // photo must not be lost because it could not be made smaller.
      console.error("compressImage failed; storing the original", cause);
    }
  }

  const relativePath = `${folder}/${crypto.randomUUID()}.${ext}`;
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

  const r2 = getR2Config();
  if (r2) {
    const client = getR2Client(r2.accountId, r2.accessKeyId, r2.secretAccessKey);
    await client.send(
      new PutObjectCommand({ Bucket: r2.bucket, Key: relativePath, Body: buffer, ContentType: contentType })
    );
    return { url: `${r2.publicUrl}/${relativePath}`, fileType: ext, fileSize: buffer.length };
  }

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(relativePath, buffer, { access: "public", addRandomSuffix: false });
    return { url: blob.url, fileType: ext, fileSize: buffer.length };
  }

  const destDir = path.join(UPLOAD_ROOT, folder);
  await mkdir(destDir, { recursive: true });
  await writeFile(path.join(UPLOAD_ROOT, relativePath), buffer);
  return { url: `/uploads/${relativePath}`, fileType: ext, fileSize: buffer.length };
}

/**
 * A stored file read back through the storage API rather than its public URL.
 *
 * R2's public `r2.dev` address is not reachable from every network the studio
 * uses — a phone on some Jordanian connections cannot open it at all — while
 * the platform's own address always is. So `/api/media` serves a stored file
 * from here, and only a file in this bucket: anything else is null, which
 * keeps the route from being a proxy to the rest of the internet.
 */
export async function readStoredFile(
  url: string,
  range: string | null
): Promise<{
  body: ReadableStream;
  contentType: string | null;
  contentLength: number | null;
  contentRange: string | null;
  status: 200 | 206;
} | null> {
  const r2 = getR2Config();
  if (!r2 || !url.startsWith(`${r2.publicUrl}/`)) return null;

  const key = decodeURIComponent(url.slice(r2.publicUrl.length + 1).split("?")[0]);
  if (!key || key.includes("..")) return null;

  const client = getR2Client(r2.accountId, r2.accessKeyId, r2.secretAccessKey);
  try {
    const object = await client.send(
      new GetObjectCommand({ Bucket: r2.bucket, Key: key, ...(range ? { Range: range } : {}) })
    );
    if (!object.Body) return null;
    return {
      body: object.Body.transformToWebStream() as ReadableStream,
      contentType: object.ContentType ?? null,
      contentLength: typeof object.ContentLength === "number" ? object.ContentLength : null,
      contentRange: object.ContentRange ?? null,
      status: object.ContentRange ? 206 : 200,
    };
  } catch {
    return null;
  }
}

export async function deleteFile(url: string | null | undefined) {
  if (!url) return;

  const r2 = getR2Config();
  if (r2 && url.startsWith(r2.publicUrl)) {
    const key = url.slice(r2.publicUrl.length + 1);
    const client = getR2Client(r2.accountId, r2.accessKeyId, r2.secretAccessKey);
    await client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key })).catch(() => {});
    return;
  }

  if (url.startsWith("http")) {
    await del(url).catch(() => {});
    return;
  }
  if (url.startsWith("/uploads/")) {
    await unlink(path.join(process.cwd(), "public", url)).catch(() => {});
  }
}
