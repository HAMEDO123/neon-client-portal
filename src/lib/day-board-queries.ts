import { prisma } from "@/lib/db";
import { getDayPlan } from "@/lib/day-plan-store";
import { allTasks } from "@/lib/employee-tasks";
import { getTimezone, getWorkHours } from "@/lib/settings";
import { readinessOf } from "@/lib/task-readiness";
import { minutesOf, remainingMinutes, capacityMinutes, type WorkHours } from "@/lib/work-hours";
import { dayKeyToDate, todayKey, wallClockIn } from "@/lib/time";
import type { PersonDay } from "@/lib/day-board";

// Gathering what the manager's day board is a judgement about.
//
// The judgements themselves are in lib/day-board.ts, where they are tested
// without a database. This is the part that fetches: one person at a time, one
// query after another, because the local Postgres proxy drops connections when
// a page fires them all at once.

/** The blocks of a plan, as minutes of work rather than as rows. */
function plannedMinutes(blocks: { from: string; to: string; keep: boolean }[]): number {
  return blocks
    .filter((block) => block.keep)
    .reduce((total, block) => {
      const from = minutesOf(block.from);
      const to = minutesOf(block.to);
      return total + (from == null || to == null || to <= from ? 0 : to - from);
    }, 0);
}

/**
 * Everything the board says about one person's day.
 *
 * Silence is carried as silence: an unanswered question is counted, never
 * turned into a claim that nothing happened.
 */
async function personDay(
  employee: { id: string; name: string },
  dayKey: string,
  hours: WorkHours,
  timezone: string,
  today: string
): Promise<PersonDay> {
  const plan = await getDayPlan(employee.id, dayKey);
  const blocks = plan?.blocks ?? [];

  const followUps = await prisma.scheduledFollowUp.findMany({
    where: { employeeId: employee.id, day: dayKeyToDate(dayKey) },
    select: { kind: true, answer: true, answerNote: true, askedAt: true, answeredAt: true, entryId: true },
  });

  // Work that cannot move, and who was named as able to clear it.
  const open = await allTasks(employee.id, "open");
  const blocked = open
    .map((task) => ({
      task,
      readiness: readinessOf({
        state: task.state,
        blockedReason: task.blockedReason,
        blockedByName: task.blockedBy?.name ?? null,
        dependencies: task.waitsFor.map((edge) => ({
          name: edge.dependsOn.task.name,
          done: edge.dependsOn.state === "DONE",
        })),
      }),
    }))
    .filter((row) => row.readiness.status === "blocked")
    .map((row) => ({
      taskName: row.task.task.name,
      reason: row.readiness.status === "blocked" ? row.readiness.reason : "",
      who: row.readiness.status === "blocked" ? row.readiness.ownerName : null,
    }));

  const names = new Map(open.map((task) => [task.id, task.task.name]));

  // Said they started, while the board still says pending. Worth seeing: one of
  // the two is wrong, and neither is an accusation.
  const contradictions = followUps
    .filter((row) => row.answer === "started" && row.entryId)
    .filter((row) => open.some((task) => task.id === row.entryId && task.state === "TODO"))
    .map((row) => ({ taskName: names.get(row.entryId as string) ?? "A task", said: "started" }));

  const needsManager = followUps
    .filter((row) => row.answer === "blocked" || row.answer === "need-info" || row.answer === "more-time")
    .map((row) => ({
      answer: row.answer as string,
      note: row.answerNote,
      taskName: row.entryId ? (names.get(row.entryId) ?? null) : null,
    }));

  const capacity = dayKey === today ? remainingMinutes(hours, wallClockIn(timezone)) : capacityMinutes(hours);

  return {
    employeeId: employee.id,
    name: employee.name,
    planned: Boolean(plan?.appliedAt),
    plannedMinutes: plannedMinutes(blocks),
    capacityMinutes: capacity,
    unanswered: followUps.filter((row) => row.askedAt && !row.answeredAt).length,
    started: followUps.filter((row) => row.kind === "block-start" && row.answer === "started").length,
    blocks: blocks.filter((block) => block.keep).length,
    needsManager,
    contradictions,
    blocked,
  };
}

/** One row per active employee, for the day being looked at. */
export async function dayBoard(dayKey: string): Promise<PersonDay[]> {
  const timezone = await getTimezone();
  const hours = await getWorkHours();
  const today = todayKey(timezone);

  const employees = await prisma.employee.findMany({
    where: { active: true, accessRole: "EMPLOYEE" },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });

  const days: PersonDay[] = [];
  // One after another on purpose; see the note at the top of this file.
  for (const employee of employees) {
    days.push(await personDay(employee, dayKey, hours, timezone, today));
  }

  return days;
}
