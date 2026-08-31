import { NextResponse } from "next/server";
import archiver from "archiver";
import { readFile } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";

async function getFileBuffer(url: string): Promise<Buffer> {
  if (url.startsWith("/")) {
    return readFile(path.join(process.cwd(), "public", url));
  }
  const res = await fetch(url);
  return Buffer.from(await res.arrayBuffer());
}

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "file";
}

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  const project = await prisma.project.findUnique({
    where: { token },
    include: { spaces: { include: { images: true } }, drawings: true, documents: true },
  });

  if (!project || project.publishState !== "PUBLISHED" || !project.allowDownloads) {
    return NextResponse.json({ error: "This package isn't available." }, { status: 404 });
  }

  const archive = archiver("zip", { zlib: { level: 9 } });

  (async () => {
    for (const space of project.spaces) {
      for (const img of space.images) {
        try {
          const buffer = await getFileBuffer(img.imageUrl);
          const ext = img.imageUrl.split(".").pop() ?? "jpg";
          archive.append(buffer, { name: `Renders/${sanitize(space.name)}/${img.id}.${ext}` });
        } catch {
          // skip files that fail to fetch rather than failing the whole package
        }
      }
    }
    for (const d of project.drawings) {
      try {
        const buffer = await getFileBuffer(d.fileUrl);
        archive.append(buffer, { name: `Drawings/${sanitize(d.category)}/${sanitize(d.name)}-${d.revision}.${d.fileType}` });
      } catch {
        // skip
      }
    }
    for (const doc of project.documents) {
      try {
        const buffer = await getFileBuffer(doc.fileUrl);
        archive.append(buffer, { name: `Documents/${sanitize(doc.category)}/${sanitize(doc.title)}.${doc.fileType}` });
      } catch {
        // skip
      }
    }
    await archive.finalize();
  })();

  await logActivity(project.id, "downloaded_package", "Complete Project Package");

  const webStream = Readable.toWeb(archive) as ReadableStream;

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${sanitize(project.name)}-NEON-Package.zip"`,
    },
  });
}
