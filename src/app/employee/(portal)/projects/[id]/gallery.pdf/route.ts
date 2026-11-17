import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionEmployee } from "@/lib/employee-session";
import { buildGalleryPdf, pdfDownload } from "@/lib/gallery-pdf";
import { pickedImages, readPicked } from "@/lib/gallery-pick";

// The gallery as a PDF from the team's project screen — the same as the
// manager's (admin/projects/[id]/gallery.pdf), because the team works a project
// exactly as the manager does. Only the renders ticked
// (`?ids=a,b,c`), in the gallery's order, and with the NEON watermark or
// without (`?watermark=1|0`, else the project's setting). Any project, published
// or not — it is the studio's own copy to send to whoever it chooses.
//
// Asked for on 2026-11-17: "بدي خيار انزل مجموعة صور معينة مش كلهم".

export const dynamic = "force-dynamic";
// Rendering every image can take a while on a large selection.
export const maxDuration = 60;

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // A route handler is a public URL — the portal layout's redirect never runs
  // for one — so it checks for itself, and answers 404 like the others.
  if (!(await getSessionEmployee())) return new NextResponse("Not found", { status: 404 });

  const { id } = await context.params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      spaces: {
        orderBy: { order: "asc" },
        include: { images: { orderBy: { order: "asc" } } },
      },
    },
  });
  if (!project) return new NextResponse("Not found", { status: 404 });

  const search = request.nextUrl.searchParams;
  const picked = readPicked(search.get("ids"));
  const watermark = search.get("watermark");

  const built = await buildGalleryPdf(project, pickedImages(project.spaces, picked), {
    watermark: watermark === "1" ? true : watermark === "0" ? false : undefined,
  });
  if (!built) return new NextResponse("None of the chosen photos are in this project any more.", { status: 404 });

  return pdfDownload(built.bytes, built.filename);
}
