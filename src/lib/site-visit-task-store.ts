import { prisma } from "@/lib/db";
import { getTimezone } from "@/lib/settings";
import { dayKeyToDate } from "@/lib/time";
import { recordStateChange } from "@/lib/task-state-log";
import { VISIT_TASK_DELIVERABLE, visitTaskNote, visitTaskPlan, visitTaskTitle } from "@/lib/site-visits";
import type { Actor } from "@/lib/task-transitions";
import type { TaskState } from "@/generated/prisma/enums";

// A site visit, among the tasks.
//
// The studio asked for a visit to "go to the tasks". It does so as an ordinary
// AssignedTask on the day of the visit — the same choice a chat task card
// makes — so the person's list, the manager's week board, the day's summary
// and the phone app all show it without any of them learning a new kind of
// work. The phone app in particular cannot be taught one from here.
//
// **The visit drives the job, and never the other way round.** A visit is
// finished by writing it up in the diary, where the client is asked and the
// manager approves; a second way to finish it — a photo sent against the job,
// a tick on the week board — would be two records of one thing, and they would
// disagree the first time somebody used the other one. So the job follows the
// visit's state and day, and every action that would change it directly is
// turned away with a sentence that says where to go (`refuseVisitTask`).
//
// Not `"use server"`: nothing here checks who is asking. Every caller has
// already done that.

/** What somebody is told when they try to change the job instead of the visit. */
export const VISIT_TASK_REFUSAL = "This is a site visit. It is changed and written up under Site visits, not here.";

/**
 * Stops an action that would change a visit's job directly.
 *
 * One lookup, in one place, for every writer of assigned tasks: the week
 * board's edit, move, delete and tick, and the proof path from both the
 * website and the phone.
 */
export async function refuseVisitTask(assignedTaskId: string): Promise<void> {
  const task = await prisma.assignedTask.findUnique({
    where: { id: assignedTaskId },
    select: { siteVisitId: true },
  });
  if (task?.siteVisitId) throw new Error(VISIT_TASK_REFUSAL);
}

/** Whether this job stands for a visit — for the paths that answer rather than throw. */
export async function isVisitTask(assignedTaskId: string): Promise<boolean> {
  const task = await prisma.assignedTask.findUnique({
    where: { id: assignedTaskId },
    select: { siteVisitId: true },
  });
  return Boolean(task?.siteVisitId);
}

export type VisitTaskSync = "created" | "updated" | "removed" | "unchanged" | "none";

/**
 * Who made a move, read off the move itself.
 *
 * The decision was taken on the visit by the person entitled to take it — the
 * one who went writes it up, the manager approves it or sends it back — and
 * this only writes down, against the job, what that decision was. Nothing here
 * decides anything, which is why it does not ask `canMove`.
 */
function moverOf(to: TaskState): Actor {
  return to === "SUBMITTED" ? "employee" : "manager";
}

function reasonFor(from: TaskState, to: TaskState): string {
  if (to === "SUBMITTED") return "Wrote the site visit up.";
  if (to === "DONE") return "Site visit approved.";
  if (from === "SUBMITTED" || from === "DONE") return "Site visit sent back.";
  return "Site visit changed.";
}

/**
 * Makes the visit's job match the visit: creates it, moves it, or removes it.
 *
 * Safe to call as often as anybody likes — after every write to a visit, and
 * from the scheduled pass that picks up any visit a failed call left behind.
 * `timeZone` is passed by a caller that already has it; otherwise it is read.
 */
export async function syncVisitTask(visitId: string, timeZone?: string): Promise<VisitTaskSync> {
  const visit = await prisma.siteVisit.findUnique({
    where: { id: visitId },
    select: {
      id: true,
      employeeId: true,
      title: true,
      location: true,
      purpose: true,
      clientName: true,
      scheduledAt: true,
      state: true,
      task: {
        select: { id: true, employeeId: true, title: true, note: true, startDay: true, endDay: true, state: true },
      },
    },
  });
  if (!visit) return "none";

  const zone = timeZone ?? (await getTimezone());
  const plan = visitTaskPlan(visit, zone);

  if (!plan) {
    if (!visit.task) return "none";
    await prisma.assignedTask.delete({ where: { id: visit.task.id } }).catch(() => null);
    return "removed";
  }

  const day = dayKeyToDate(plan.dayKey);
  const title = visitTaskTitle(visit.title);
  const note = visitTaskNote(visit, zone);

  if (!visit.task) {
    try {
      const created = await prisma.assignedTask.create({
        data: {
          employeeId: visit.employeeId,
          siteVisitId: visit.id,
          title,
          note,
          deliverable: VISIT_TASK_DELIVERABLE,
          startDay: day,
          endDay: day,
          state: plan.state,
          completedAt: plan.state === "DONE" ? new Date() : null,
        },
        select: { id: true },
      });
      if (plan.state !== "TODO") {
        await recordStateChange({
          assignedTaskId: created.id,
          from: "TODO",
          to: plan.state,
          actor: moverOf(plan.state),
          actorEmployeeId: plan.state === "SUBMITTED" ? visit.employeeId : null,
          reason: reasonFor("TODO", plan.state),
        });
      }
      return "created";
    } catch (error) {
      // Two calls at once: the unique index let one of them in, and the job it
      // made is the one this call wanted too.
      if ((error as { code?: string } | null)?.code === "P2002") return "unchanged";
      throw error;
    }
  }

  const task = visit.task;
  // Somebody who has marked it started keeps that: a planned visit says "to
  // do", and being on the way to it is not a contradiction of the plan.
  const state: TaskState = plan.state === "TODO" && task.state === "IN_PROGRESS" ? "IN_PROGRESS" : plan.state;

  const same =
    task.employeeId === visit.employeeId &&
    task.title === title &&
    (task.note ?? null) === (note ?? null) &&
    task.startDay.getTime() === day.getTime() &&
    task.endDay.getTime() === day.getTime() &&
    task.state === state;
  if (same) return "unchanged";

  await prisma.assignedTask.update({
    where: { id: task.id },
    data: {
      employeeId: visit.employeeId,
      title,
      note,
      startDay: day,
      endDay: day,
      state,
      ...(task.state !== state ? { completedAt: state === "DONE" ? new Date() : null } : {}),
    },
  });

  if (task.state !== state) {
    await recordStateChange({
      assignedTaskId: task.id,
      from: task.state,
      to: state,
      actor: moverOf(state),
      actorEmployeeId: state === "SUBMITTED" ? visit.employeeId : null,
      reason: reasonFor(task.state, state),
    });
  }

  return "updated";
}

/**
 * `syncVisitTask`, for the moments a failure must not travel: a visit that was
 * written down, answered for or approved has happened, and must not be undone
 * because its job could not be moved. The scheduled pass picks it up.
 */
export async function syncVisitTaskQuietly(visitId: string, timeZone?: string): Promise<void> {
  await syncVisitTask(visitId, timeZone).catch((error) => {
    console.error("[site-visit-task] could not sync", visitId, error instanceof Error ? error.message : error);
  });
}
