import { prisma } from "@/lib/db";
import { getTaskBoard } from "@/lib/queries";
import { getTimezone } from "@/lib/settings";
import { dayKeyIn, todayKey, tomorrowKey, wallClockIn } from "@/lib/time";
import { planForProjects } from "@/lib/stage-deadlines";
import { assignedTasksForWeek } from "@/lib/assigned-tasks";

// The manager's project board, for the phone.
//
// The same reading as /admin/tasks: `getTaskBoard()` for the matrix, the four
// counts on top of the page, and the "Upcoming" panel from the stage periods.
// Two things are added, both reads of columns the board already owns:
//
//   * each cell's detail (what to hand in, what counts as done, the estimate,
//     the blocker, the last word from the employee) and its due time as the
//     company's wall clock, so the phone's cell editor opens on what is saved
//     and a save sends it back unchanged rather than blank;
//   * each step's standard, so the editor can say "from the step" beside an
//     empty box instead of presenting it as though nothing applies.
//
// Reads run one after another, like the page's own: the local database falls
// over on a burst.

export async function mobileTaskBoard() {
  const timezone = await getTimezone();
  const today = todayKey(timezone);
  const tomorrow = tomorrowKey(timezone);

  const board = await getTaskBoard();

  const details = await prisma.projectTaskEntry.findMany({
    where: { project: { publishState: { not: "ARCHIVED" } } },
    select: {
      id: true,
      deliverable: true,
      acceptance: true,
      estimateHours: true,
      blockedReason: true,
      blockedById: true,
      lastUpdateNote: true,
      lastUpdateAt: true,
      nextStep: true,
      startedAt: true,
      completedAt: true,
    },
  });
  const detailById = new Map(details.map((row) => [row.id, row]));

  const standards = await prisma.processTask.findMany({
    select: { id: true, deliverable: true, acceptance: true, estimateHours: true },
  });
  const standardById = new Map(standards.map((row) => [row.id, row]));

  const rows = board.rows.map((row) => ({
    project: row.project,
    done: row.done,
    tomorrow: row.tomorrow,
    cells: row.cells.map((cell) => {
      const extra = cell.entryId ? detailById.get(cell.entryId) : undefined;
      return {
        ...cell,
        // The editor's time box is the studio's clock, as the server reads it
        // back (`instantAt(day, time, timezone)`), never the phone's.
        dueTime: cell.dueAt ? wallClockIn(timezone, new Date(cell.dueAt)) : null,
        deliverable: extra?.deliverable ?? null,
        acceptance: extra?.acceptance ?? null,
        estimateHours: extra?.estimateHours ?? null,
        blockedReason: extra?.blockedReason ?? null,
        blockedById: extra?.blockedById ?? null,
        lastUpdateNote: extra?.lastUpdateNote ?? null,
        lastUpdateAt: extra?.lastUpdateAt ?? null,
        nextStep: extra?.nextStep ?? null,
        startedAt: extra?.startedAt ?? null,
        completedAt: extra?.completedAt ?? null,
      };
    }),
  }));

  const steps = board.steps.map((step) => {
    const standard = standardById.get(step.id);
    return {
      ...step,
      deliverable: standard?.deliverable ?? null,
      acceptance: standard?.acceptance ?? null,
      estimateHours: standard?.estimateHours ?? null,
    };
  });

  // The four counts on top of the page, by the page's own rules: work marked
  // "not counted" is out of the totals, and a job handed out for tomorrow is
  // due tomorrow just as much as a step flagged for it. The jobs are read from
  // the week that holds tomorrow, so a Saturday still counts Sunday's.
  const cells = board.rows.flatMap((row) => row.cells);
  const counted = cells.filter((cell) => !cell.excludedFromProgress);
  const jobsTomorrow = (await assignedTasksForWeek(tomorrow)).filter((task) => task.startKey === tomorrow).length;

  const stats = {
    activeProjects: board.rows.length,
    stepsDone: counted.filter((cell) => cell.state === "DONE").length,
    stepsCounted: counted.length,
    inProgress: cells.filter((cell) => cell.state === "IN_PROGRESS").length,
    dueTomorrow: cells.filter((cell) => cell.state === "TOMORROW").length + jobsTomorrow,
  };

  // What the stage periods say is due next, soonest first, two per project at
  // most — the page's "Upcoming" panel.
  const plan = await planForProjects(board.rows.map((row) => row.project.id));
  const soonest = [...plan.values()]
    .filter((stage) => stage.state !== "DONE" && !stage.excludedFromProgress && stage.dueBy)
    .sort((a, b) => a.dueBy!.getTime() - b.dueBy!.getTime());
  const takenPerProject = new Map<string, number>();
  const upcoming = soonest
    .filter((stage) => {
      const taken = takenPerProject.get(stage.projectId) ?? 0;
      if (taken >= 2) return false;
      takenPerProject.set(stage.projectId, taken + 1);
      return true;
    })
    .slice(0, 6)
    .map((stage) => ({
      projectId: stage.projectId,
      projectName: stage.projectName,
      taskId: stage.taskId,
      taskName: stage.taskName,
      state: stage.state,
      dueBy: stage.dueBy!.toISOString(),
      dueDayKey: dayKeyIn(timezone, stage.dueBy!),
      source: stage.source,
    }));

  // Work somebody has sent proof for, waiting on the manager: the board's own
  // cells and the jobs handed out by hand.
  const jobsAwaitingReview = await prisma.assignedTask.count({ where: { state: "SUBMITTED" } });
  const awaitingReview = cells.filter((cell) => cell.state === "SUBMITTED").length + jobsAwaitingReview;

  return {
    timezone,
    todayKey: today,
    tomorrowKey: tomorrow,
    sections: board.sections,
    steps,
    team: board.team,
    sectionTeam: board.sectionTeam,
    rows,
    stats,
    upcoming,
    awaitingReview,
  };
}
