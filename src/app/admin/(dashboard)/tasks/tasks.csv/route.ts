import { NextResponse, type NextRequest } from "next/server";
import { hasAdminSession } from "@/lib/session-token";
import { getTimezone } from "@/lib/settings";
import { todayKey } from "@/lib/time";
import { loadMonthTasks, readMonth, tasksCsv } from "@/lib/monthly-export";

// A month of tasks as a spreadsheet: everything each person was due to do,
// what was asked, what they sent, and whether it was done.

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Checked here, not by the layout — see reports.csv and timesheet.csv.
  if (!(await hasAdminSession())) return new NextResponse("Not found", { status: 404 });

  const timezone = await getTimezone();
  const today = todayKey(timezone);
  const month = readMonth(request.nextUrl.searchParams.get("month"), today);
  const csv = tasksCsv(await loadMonthTasks(month, timezone), today);

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="tasks-${month}.csv"`,
      "cache-control": "no-store",
    },
  });
}
