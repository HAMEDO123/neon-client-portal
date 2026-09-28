import { prisma } from "@/lib/db";
import { getEmployees } from "@/lib/queries";
import { getTimezone } from "@/lib/settings";
import { shiftDayKey, todayKey, tomorrowKey } from "@/lib/time";
import { assignedTasksForWeek } from "@/lib/assigned-tasks";
import { weekDayKeys, weekStartKey } from "@/lib/week";

// The week board, for the phone: the jobs the manager hands out by hand, over
// the days they run for, one person at a time.
//
// The same reading as the week under /admin/tasks — `assignedTasksForWeek` for
// the jobs, and the board's own team (active staff, in their order) for the
// rows. Which week is shown comes in as `?week=`, exactly as the page's link
// carries it; anything else is this week. Weeks start on Sunday (lib/week.ts).

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export async function mobileWeekBoard(week: string | null) {
  const timezone = await getTimezone();
  const today = todayKey(timezone);
  const anchor = week && DAY_KEY.test(week) ? week : today;

  // `getTaskBoard().team`, without reading the whole board for it.
  const employees = await getEmployees();
  const team = employees
    .filter((employee) => employee.active)
    .map((employee) => ({
      id: employee.id,
      name: employee.name,
      role: employee.role,
      color: employee.color,
    }));

  const jobs = await assignedTasksForWeek(anchor);

  // What the week view keeps one hover away: which jobs came from a chat card,
  // and the last thing the person said about theirs.
  const extras = jobs.length
    ? await prisma.assignedTask.findMany({
        where: { id: { in: jobs.map((job) => job.id) } },
        select: { id: true, chatTaskId: true, lastUpdateNote: true, lastUpdateAt: true, nextStep: true },
      })
    : [];
  const extraById = new Map(extras.map((row) => [row.id, row]));

  const weekStart = weekStartKey(anchor);

  return {
    timezone,
    todayKey: today,
    tomorrowKey: tomorrowKey(timezone),
    weekStart,
    weekKeys: weekDayKeys(anchor),
    previousWeek: shiftDayKey(weekStart, -7),
    nextWeek: shiftDayKey(weekStart, 7),
    team,
    tasks: jobs.map((job) => {
      const extra = extraById.get(job.id);
      return {
        ...job,
        chatTaskId: extra?.chatTaskId ?? null,
        lastUpdateNote: extra?.lastUpdateNote ?? null,
        lastUpdateAt: extra?.lastUpdateAt ?? null,
        nextStep: extra?.nextStep ?? null,
      };
    }),
  };
}
