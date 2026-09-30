import { prisma } from "@/lib/db";
import { avatarUrl } from "@/lib/avatar";
import { ownedBy } from "@/lib/employee-tasks";
import { getEmployees } from "@/lib/queries";
import { getTimezone } from "@/lib/settings";
import { planForProjects } from "@/lib/stage-deadlines";
import { dateToDayKey, dayKeyIn, dayKeyToDate, shiftDayKey, todayKey, wallClockIn } from "@/lib/time";
import {
  cellOverdue,
  jobOverdue,
  periodWindow,
  sortItems,
  tallyWork,
  type PeoplePeriod,
} from "@/lib/mobile/tasks-people-rules";

// The "Team" segment of the manager's Tasks tab: for every active person on
// the board, how much of what they were given this week (or month) they
// finished — 100%, 20% — and the list behind the number.
//
// What counts, and why it agrees with the website:
//
//   * Board cells are the person's by `ownedBy` (lib/employee-tasks.ts) — the
//     rule the board, their own list and the analytics use — never worked out
//     again here.
//   * A cell belongs to the period exactly as it does in the analytics page's
//     monthly figure (`getEmployeeProgress`, lib/analytics-queries.ts):
//     scheduled in it, due in it, or — having neither date — created in it,
//     with the same day boundaries; and cells marked "not counted" stay out.
//     So for a month, `boardCells` is the web's "Done x/y" for that person.
//   * Jobs handed out by hand (the week board, and chat task cards) count when
//     they overlap the period — the rule `assignedTasksForWeek` uses for a week
//     (lib/assigned-tasks.ts), over the period's days. The web's monthly figure
//     counts board cells only; its daily one counts both, as this does.
//   * Where each piece stands is `countStates`, and the percentage is
//     `percentDone` (lib/progress.ts) — null when nothing was given.
//   * A cell's deadline is the one the studio chases: typed on the cell, else
//     worked out from the stage periods (`planForProjects`), as the analytics
//     page's live "Late" figure reads it.
//
// Reads run one after another, like every multi-query read here: the local
// Postgres proxy falls over on a burst.

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day, or nothing: "2026-02-31" is not a day. */
function validDay(value: string | null) {
  if (!value || !DAY_KEY.test(value)) return null;
  return shiftDayKey(value, 0) === value ? value : null;
}

const cellSelect = {
  id: true,
  projectId: true,
  taskId: true,
  state: true,
  priority: true,
  scheduledFor: true,
  dueAt: true,
  completedAt: true,
  project: { select: { name: true } },
  task: { select: { name: true } },
} as const;

export async function mobileTaskPeople(period: PeoplePeriod, day: string | null, now = new Date()) {
  const timezone = await getTimezone();
  const today = todayKey(timezone);
  const anchor = validDay(day) ?? today;
  const window = periodWindow(period, anchor);

  // Calendar dates, as the analytics query compares them: from the first day
  // up to (not including) the day after the last.
  const start = dayKeyToDate(window.from);
  const end = dayKeyToDate(shiftDayKey(window.to, 1));

  // The board's own team: active staff, in the board's order.
  const team = (await getEmployees()).filter((employee) => employee.active);

  const cellsBy = new Map<string, Awaited<ReturnType<typeof cellsOf>>>();
  for (const person of team) {
    cellsBy.set(person.id, await cellsOf(person.id, start, end));
  }

  const jobs = team.length
    ? await prisma.assignedTask.findMany({
        where: {
          employeeId: { in: team.map((person) => person.id) },
          startDay: { lte: dayKeyToDate(window.to) },
          endDay: { gte: dayKeyToDate(window.from) },
        },
        orderBy: [{ startDay: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          employeeId: true,
          title: true,
          startDay: true,
          endDay: true,
          state: true,
          priority: true,
          completedAt: true,
        },
      })
    : [];

  const projectIds = [...new Set([...cellsBy.values()].flat().map((cell) => cell.projectId))];
  const plan = await planForProjects(projectIds);

  const people = team.map((person) => {
    const cells = (cellsBy.get(person.id) ?? []).map((cell) => {
      const stage = plan.get(cell.id);
      const deadline = stage?.dueBy ?? cell.dueAt;
      const source = stage ? (stage.source === "none" ? null : stage.source) : cell.dueAt ? "explicit" : null;
      return {
        kind: "cell" as const,
        id: cell.id,
        title: cell.task.name,
        projectId: cell.projectId,
        projectName: cell.project.name,
        taskId: cell.taskId,
        state: cell.state,
        priority: cell.priority,
        scheduledFor: dateToDayKey(cell.scheduledFor),
        startDay: null,
        endDay: null,
        dueAt: deadline ? deadline.toISOString() : null,
        dueDay: deadline ? dayKeyIn(timezone, deadline) : null,
        // Only a time somebody typed; a worked-out deadline has no hour anyone chose.
        dueTime: deadline && source === "explicit" ? wallClockIn(timezone, deadline) : null,
        dueSource: source,
        completedAt: cell.completedAt ? cell.completedAt.toISOString() : null,
        overdue: cellOverdue(cell.state, deadline, now),
      };
    });

    const handed = jobs
      .filter((job) => job.employeeId === person.id)
      .map((job) => {
        const startKey = dateToDayKey(job.startDay)!;
        const endKey = dateToDayKey(job.endDay)!;
        return {
          kind: "job" as const,
          id: job.id,
          title: job.title,
          projectId: null,
          projectName: null,
          taskId: null,
          state: job.state,
          priority: job.priority,
          scheduledFor: null,
          startDay: startKey,
          endDay: endKey,
          dueAt: null,
          dueDay: endKey,
          dueTime: null,
          dueSource: "explicit" as const,
          completedAt: job.completedAt ? job.completedAt.toISOString() : null,
          overdue: jobOverdue(job.state, endKey, today),
        };
      });

    const items = sortItems([...cells, ...handed]);

    return {
      id: person.id,
      name: person.name,
      role: person.role,
      color: person.color,
      // Their photo, or the studio's face for somebody with no photo:
      // initials on their colour.
      avatar: person.photoUrl ?? avatarUrl(person.name, person.color),
      ...tallyWork(items),
      items,
    };
  });

  return {
    timezone,
    todayKey: today,
    period,
    from: window.from,
    to: window.to,
    previous: window.previous,
    next: window.next,
    current: window.from <= today && today <= window.to,
    people,
  };
}

/** One person's board cells in the period, by the analytics page's rule. */
async function cellsOf(employeeId: string, start: Date, end: Date) {
  return prisma.projectTaskEntry.findMany({
    where: {
      AND: [
        await ownedBy(employeeId),
        { excludedFromProgress: false },
        {
          OR: [
            { scheduledFor: { gte: start, lt: end } },
            { dueAt: { gte: start, lt: end } },
            { scheduledFor: null, dueAt: null, createdAt: { gte: start, lt: end } },
          ],
        },
      ],
    },
    select: cellSelect,
  });
}
