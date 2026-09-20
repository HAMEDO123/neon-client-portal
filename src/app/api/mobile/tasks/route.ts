import { NextResponse } from "next/server";
import { mobileStaff } from "@/lib/mobile-auth";
import { allTasks, tasksForDay } from "@/lib/employee-tasks";
import { getTimezone } from "@/lib/settings";
import { todayKey, tomorrowKey } from "@/lib/time";

// The employee's own work.
//
// `?day=today` (the default), `tomorrow`, `open`, or `completed`. Ownership is
// `ownedBy` in lib/employee-tasks.ts — the cell's assignee, else the section
// holder, else the step's standing owner — and is not rewritten here. A filter
// spelled out again in this route is the third copy of that rule, and the one
// that would quietly count somebody else's work as yours.

export async function GET(request: Request) {
  const staff = await mobileStaff(request);
  if (!staff) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  // The manager has no "my tasks" — their view of the work is the board, which
  // is a different screen answering a different question. Saying so plainly
  // beats returning an empty list they would read as "nothing to do".
  if (staff.type === "ADMIN") {
    return NextResponse.json(
      { error: "The manager's view of the work is the board, not a personal list." },
      { status: 403 }
    );
  }

  const day = new URL(request.url).searchParams.get("day") ?? "today";

  if (day === "open" || day === "completed") {
    return NextResponse.json({ day, tasks: await allTasks(staff.id, day) });
  }

  const timezone = await getTimezone();
  // Days are calendar days in the company's timezone. Amman is three hours
  // ahead of UTC, so grouping on the raw clock files work under the wrong day.
  const key = day === "tomorrow" ? tomorrowKey(timezone) : todayKey(timezone);

  // "Tomorrow" also sweeps in anything the manager flagged TOMORROW, as the
  // portal's own day does.
  const tasks = await tasksForDay(staff.id, key, day === "tomorrow" ? "tomorrow" : null);

  return NextResponse.json({ day, dayKey: key, tasks });
}
