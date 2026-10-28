import { NextResponse, type NextRequest } from "next/server";
import { hasAdminSession } from "@/lib/session-token";
import { getAttendanceSheet } from "@/lib/payroll-queries";
import { attendanceSheetCsv } from "@/lib/attendance-sheet";
import { getTimezone } from "@/lib/settings";
import { periodOf } from "@/lib/payroll";
import { todayKey } from "@/lib/time";

// The month sheet as a spreadsheet: one row per person per day, the totals
// under it. Same builder as the screen, so the file and the page cannot
// disagree about a figure.

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Guarded here rather than relying on the dashboard layout: a route handler
  // is a public URL, and the layout's redirect never runs for one. This is the
  // whole team's pay, which is `requireAdmin` territory (lib/admin-guard.ts) —
  // it answers 404 rather than 401 so the URL does not advertise itself.
  if (!(await hasAdminSession())) return new NextResponse("Not found", { status: 404 });

  const timezone = await getTimezone();
  const requested = request.nextUrl.searchParams.get("period");
  const period = requested && /^\d{4}-\d{2}$/.test(requested) ? requested : periodOf(todayKey(timezone));

  const csv = attendanceSheetCsv(await getAttendanceSheet(period));

  return new NextResponse(csv, {
    headers: {
      // `charset=utf-8` and the mark the builder writes: between them, Excel
      // stops guessing a codepage and mangling a name or a note.
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="attendance-${period}.csv"`,
      // Somebody's pay, and it changes as the device reads. Never a stale copy.
      "cache-control": "no-store",
    },
  });
}
