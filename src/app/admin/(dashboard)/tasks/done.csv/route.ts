import { NextResponse, type NextRequest } from "next/server";
import { hasAdminSession } from "@/lib/session-token";
import { getTimezone } from "@/lib/settings";
import { todayKey } from "@/lib/time";
import { doneTasksCsv, loadMonthDone, readMonth } from "@/lib/monthly-export";

// A month of finished work as a spreadsheet: every job and project step the
// manager approved, each person's in the order it was approved.

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Checked here, not by the layout — see reports.csv and timesheet.csv.
  if (!(await hasAdminSession())) return new NextResponse("Not found", { status: 404 });

  const timezone = await getTimezone();
  const month = readMonth(request.nextUrl.searchParams.get("month"), todayKey(timezone));
  const csv = doneTasksCsv(await loadMonthDone(month, timezone));

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="tasks-done-${month}.csv"`,
      "cache-control": "no-store",
    },
  });
}
