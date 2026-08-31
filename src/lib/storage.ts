import { put, del } from "@vercel/blob";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import sharp from "sharp";

const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");

type UploadKind = "image" | "document";

const RULES: Record<UploadKind, { types: string[]; maxBytes: number; label: string }> = {
  image: {
    types: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"],
    maxBytes: 12 * 1024 * 1024,
    label: "JPEG, PNG, WebP, GIF, or AVIF (max 12MB)",
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
      "application/octet-stream", // DWG and other CAD files report this generic type in most browsers
    ],
    maxBytes: 50 * 1024 * 1024,
    label: "PDF, DOCX, XLSX, ZIP, MP4, DWG, or image (max 50MB)",
  },
};

// Renders and photos over this size are recompressed before storage — keeps the
// gallery fast to load without asking admins to pre-shrink every export manually.
const COMPRESS_THRESHOLD_BYTES = 1 * 1024 * 1024;
const MAX_DIMENSION = 2400;

async function compressImage(buffer: Buffer): Promise<{ buffer: Buffer; ext: string }> {
  const resized = sharp(buffer).resize({
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
  if (!rule.types.includes(file.type)) {
    throw new Error(`Unsupported file type. Use: ${rule.label}.`);
  }
  if (file.size > rule.maxBytes) {
    throw new Error(`File is too large. Max size: ${rule.label.split("max ")[1] ?? "limit"}.`);
  }

  let buffer: Buffer = Buffer.from(await file.arrayBuffer());
  let ext = extFromFile(file);

  if (kind === "image" && compress && buffer.length > COMPRESS_THRESHOLD_BYTES) {
    const compressed = await compressImage(buffer);
    buffer = compressed.buffer;
    ext = compressed.ext;
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
