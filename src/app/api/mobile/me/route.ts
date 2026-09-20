import { NextResponse } from "next/server";
import { mobileViewer } from "@/lib/mobile-auth";
import { getEmployeeBadges } from "@/lib/employee-badges";
import { warningsFor } from "@/lib/employee-warnings";

// Who is signed in, and what is waiting for them.
//
// The app calls this on launch: it is how it knows which side it is showing,
// what to put on the tab badges, and whether there is a warning that has to sit
// at the top of the screen until the manager removes it.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await mobileViewer(request);
  if (!viewer) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  if (viewer.type === "ADMIN") {
    return NextResponse.json({ side: "ADMIN", name: viewer.name });
  }

  const [badges, warnings] = await Promise.all([getEmployeeBadges(viewer.id), warningsFor(viewer.id)]);

  return NextResponse.json({
    side: "EMPLOYEE",
    id: viewer.id,
    name: viewer.name,
    badges,
    // Shown pinned until the manager withdraws them — the app must not let
    // these be dismissed, the same as the portal.
    warnings,
  });
}
