import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { pdfDownload } from "@/lib/gallery-pdf";
import { buildProjectBook } from "@/lib/project-book-pdf";

// The whole project as one PDF for the client: renders, drawings, documents,
// and the BOQ, materials, furniture and pricing they are shown — the same
// access rules as the zip package and the gallery PDF: published projects with
// downloads allowed. The document itself is lib/project-book-pdf.ts.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  const project = await prisma.project.findUnique({
    where: { token },
    include: {
      spaces: { orderBy: { order: "asc" }, include: { images: { orderBy: { order: "asc" } } } },
      drawings: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
      documents: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
      boqItems: { orderBy: { order: "asc" } },
      materials: { orderBy: { order: "asc" } },
      furniture: { orderBy: { order: "asc" } },
      pricingItems: { orderBy: { order: "asc" } },
    },
  });

  if (!project || project.publishState !== "PUBLISHED" || !project.allowDownloads) {
    return NextResponse.json({ error: "This file isn't available." }, { status: 404 });
  }

  const built = await buildProjectBook(project);
  if (!built) return NextResponse.json({ error: "There is nothing in this project to put in a PDF yet." }, { status: 404 });

  await logActivity(project.id, "downloaded_project_pdf", "Project PDF");
  // `?inline=1` is "Open the PDF": shown in the browser rather than saved.
  return pdfDownload(built.bytes, built.filename, new URL(request.url).searchParams.get("inline") === "1");
}
