import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { buildGalleryPdf, pdfDownload } from "@/lib/gallery-pdf";

// The gallery as one PDF the client can keep or forward — same access rules
// as the handover package: published projects with downloads allowed. The
// document itself is lib/gallery-pdf.ts, shared with the manager's screen.

export const dynamic = "force-dynamic";
// Rendering every image can take a while on a large gallery.
export const maxDuration = 60;

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  const project = await prisma.project.findUnique({
    where: { token },
    include: {
      spaces: {
        orderBy: { order: "asc" },
        include: { images: { orderBy: { order: "asc" } } },
      },
    },
  });

  if (!project || project.publishState !== "PUBLISHED" || !project.allowDownloads) {
    return NextResponse.json({ error: "This gallery isn't available." }, { status: 404 });
  }

  const built = await buildGalleryPdf(project, project.spaces);
  if (!built) {
    return NextResponse.json({ error: "This project has no renders yet." }, { status: 404 });
  }

  await logActivity(project.id, "downloaded_gallery_pdf", `${built.totalImages} renders`);
  return pdfDownload(built.bytes, built.filename);
}
