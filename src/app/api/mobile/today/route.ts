import { NextResponse } from "next/server";
import { mobileEmployee } from "@/lib/mobile-auth";
import { myDay } from "@/lib/now-next-queries";
import { tasksForDay } from "@/lib/employee-tasks";
import { linesOf, reportForDay } from "@/lib/daily-report";

// The employee's own day: what now, what it is for, what next, and the work
// that sits on today — the same three questions the portal's home answers.
//
// `myDay` is the shared reading, so the app and the web say the same thing
// about a day, including the refusals: an empty day says nothing is planned
// rather than implying idleness, and outside working hours it says the hours.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const employee = await mobileEmployee(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const day = await myDay(employee.id);
  const [today, tomorrow] = await Promise.all([
    tasksForDay(employee.id, day.dayKey),
    tasksForDay(employee.id, day.dayKey, "tomorrow"),
  ]);

  // Today's report, so it can be written from this screen as things are
  // finished rather than remembered on another one at the end of the day.
  const report = await reportForDay(employee.id, day.dayKey);

  return NextResponse.json({
    dayKey: day.dayKey,
    report: {
      text: report.text,
      lines: linesOf(report.text),
      updatedAt: report.updatedAt,
    },
    nowNext: day.state,
    hours: day.hours,
    tasks: today,
    tomorrow,
  });
}
