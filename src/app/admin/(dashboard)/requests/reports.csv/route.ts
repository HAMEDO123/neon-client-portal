import { NextResponse, type NextRequest } from "next/server";
import { hasAdminSession } from "@/lib/session-token";
import { getTimezone } from "@/lib/settings";
import { todayKey } from "@/lib/time";
import { loadMonthReports, readMonth, reportsCsv } from "@/lib/monthly-export";

// A month of daily reports as a spreadsheet: each person, day by day.

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // A route handler is a public URL — the dashboard layout's redirect never
  // runs for one — so it checks for itself, and answers 404 rather than 401
  // so the URL does not advertise itself. Same as timesheet.csv.
  if (!(await hasAdminSession())) return new NextResponse("Not found", { status: 404 });

  const timezone = await getTimezone();
  const month = readMonth(request.nextUrl.searchParams.get("month"), todayKey(timezone));
  const csv = reportsCsv(await loadMonthReports(month, timezone));

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="reports-${month}.csv"`,
      "cache-control": "no-store",
    },
  });
}
