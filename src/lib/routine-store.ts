import { prisma } from "@/lib/db";
import { getTimezone, getWorkHours } from "@/lib/settings";
import { dayKeyIn, dayKeyToDate } from "@/lib/time";
import { isWorkingDay } from "@/lib/work-hours";

// Routine tasks: something one person does every working day.
//
// A routine is the standing instruction; each working day it becomes that
// day's ordinary job (`AssignedTask.routineId`). Not a new kind of work, for
// the reason a chat task card and a site visit are not either: the person's
// list, the week board, photo proof, review, the nine o'clock rule and the
// phone app already know what a job is, and none of them has to learn this.
//
// Deliberately not "use server".

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

export function listRoutines() {
  return prisma.routineTask.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    include: { employee: { select: { id: true, name: true, color: true, photoUrl: true, active: true } } },
  });
}

/**
 * Today's job for every routine that is on, for whoever is still on the team.
 *
 * Safe to ask for on every scheduler pass: one job per routine per day is a
 * unique index, so a second pass — or two at once — makes nothing twice. A day
 * the studio does not work makes none; a day the server missed is not made up
 * afterwards, because yesterday's routine handed out today is already late.
 */
export async function ensureTodaysRoutines(now = new Date(), only?: string) {
  const timeZone = await getTimezone();
  const dayKey = dayKeyIn(timeZone, now);
  if (!isWorkingDay(await getWorkHours(), dayKey)) return { day: dayKey, made: 0, working: false };

  const routines = await prisma.routineTask.findMany({
    where: { active: true, employee: { active: true, accessRole: "EMPLOYEE" }, ...(only ? { id: only } : {}) },
  });

  const day = dayKeyToDate(dayKey);
  let made = 0;
  for (const routine of routines) {
    try {
      await prisma.assignedTask.create({
        data: {
          employeeId: routine.employeeId,
          title: routine.title,
          note: routine.note,
          acceptance: routine.acceptance,
          priority: routine.priority,
          startDay: day,
          endDay: day,
          routineId: routine.id,
        },
      });
      made++;
    } catch (error) {
      // Already there for today: the ordinary case on every pass but the first.
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return { day: dayKey, made, working: true };
}
