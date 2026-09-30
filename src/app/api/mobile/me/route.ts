import { NextResponse } from "next/server";
import { mobileViewer } from "@/lib/mobile-auth";
import { getEmployeeBadges } from "@/lib/employee-badges";
import { warningsFor } from "@/lib/employee-warnings";
import { prisma } from "@/lib/db";
import { managerEmployeeId } from "@/lib/manager-account";

// Who is signed in, and what is waiting for them.
//
// The app calls this on launch: it is how it knows which side it is showing,
// what to put on the tab badges, and whether there is a warning that has to sit
// at the top of the screen until the manager removes it.
//
// It also hands back the person's own face (`photoUrl`, null for initials), so
// the app can draw it on their own screens — "My Story", the account button,
// the profile — without a read of its own. For the manager that is the photo
// on their own `Employee` row (lib/manager-account.ts), the one
// `POST /api/mobile/me/photo` writes; `canSetPhoto` is false when this studio
// has no such row, so the app can say so rather than offer a button that fails.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await mobileViewer(request);
  if (!viewer) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  if (viewer.type === "ADMIN") {
    const rowId = await managerEmployeeId();
    const row = rowId
      ? await prisma.employee.findUnique({ where: { id: rowId }, select: { photoUrl: true } })
      : null;
    return NextResponse.json({
      side: "ADMIN",
      name: viewer.name,
      photoUrl: row?.photoUrl ?? null,
      canSetPhoto: rowId !== null,
    });
  }

  const [badges, warnings, face] = await Promise.all([
    getEmployeeBadges(viewer.id),
    warningsFor(viewer.id),
    prisma.employee.findUnique({ where: { id: viewer.id }, select: { photoUrl: true } }),
  ]);

  return NextResponse.json({
    side: "EMPLOYEE",
    id: viewer.id,
    name: viewer.name,
    photoUrl: face?.photoUrl ?? null,
    canSetPhoto: true,
    badges,
    // Shown pinned until the manager withdraws them — the app must not let
    // these be dismissed, the same as the portal.
    warnings,
  });
}
