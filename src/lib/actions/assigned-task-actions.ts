"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireTaskAssigner } from "@/lib/admin-guard";
import { dayKeyToDate, todayKey } from "@/lib/time";
import { getTimezone } from "@/lib/settings";
import { draftTasksFromWords, type DictationResult } from "@/lib/ai/task-dictation";
import { MAX_DRAFTS, briefingCopy, readDraft, type TaskDraft } from "@/lib/task-dictation";
import { daysBetween } from "@/lib/week";
import { dispatchNotification } from "@/lib/notifications/engine";
import { recordStateChange } from "@/lib/task-state-log";
import { canMove } from "@/lib/task-transitions";
import { refuseVisitTask } from "@/lib/site-visit-task-store";
import type { TaskPriority } from "@/generated/prisma/enums";

// Handing out work that is not part of any project.
//
// The manager writes what it is, who does it, and the days it runs over. That
// last part is the whole point of the week view: "two days to go and negotiate
// with the supplier" fills two cells, and everyone can see what those two days
// are already spent on.
//
// `requireTaskAssigner` rather than `requireAdmin`, because the studio decided
// the manager is not the only person who hands work out — see the guard, which
// is one person at a time and not the team. It is deliberately not
// `requireStaff`: what someone else spends their day on is not the same kind
// of thing as the contents of a project.

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Where a notification about a job lands: the job itself, not the dashboard. */
const jobUrl = (id: string) => `/employee/assigned/${id}`;
const PRIORITIES: TaskPriority[] = ["LOW", "MEDIUM", "HIGH"];

function refresh() {
  revalidatePath("/admin/tasks");
  revalidatePath("/employee", "layout");
}

/**
 * Reads the form into a job. The end day is whichever way round the two dates
 * were given, and a job with no end is a one-day job — nobody should have to
 * type the same date twice to say "today".
 */
function readForm(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  if (!title) throw new Error("Give the task a name.");

  const employeeId = String(formData.get("employeeId") ?? "").trim();
  if (!employeeId) throw new Error("Choose who it is for.");

  const startKey = String(formData.get("startDay") ?? "").trim();
  if (!DAY_KEY.test(startKey)) throw new Error("Pick the day it starts.");

  const endRaw = String(formData.get("endDay") ?? "").trim();
  const endKey = DAY_KEY.test(endRaw) ? endRaw : startKey;

  // A range typed backwards is the same range.
  const [from, to] = daysBetween(startKey, endKey) >= 0 ? [startKey, endKey] : [endKey, startKey];

  const priorityRaw = String(formData.get("priority") ?? "MEDIUM");
  const priority = PRIORITIES.includes(priorityRaw as TaskPriority)
    ? (priorityRaw as TaskPriority)
    : "MEDIUM";

  return {
    title,
    employeeId,
    note: String(formData.get("note") ?? "").trim().slice(0, 2000) || null,
    // What to hand in, and what counts as finished. The second is the one that
    // matters beyond the person doing the work: it is what a photo is checked
    // against, and a job with none can only ever come back "there was nothing
    // to check it against".
    deliverable: String(formData.get("deliverable") ?? "").trim().slice(0, 2000) || null,
    acceptance: String(formData.get("acceptance") ?? "").trim().slice(0, 4000) || null,
    startDay: dayKeyToDate(from),
    endDay: dayKeyToDate(to),
    priority,
    days: daysBetween(from, to) + 1,
  };
}

export async function createAssignedTask(formData: FormData) {
  await requireTaskAssigner();
  const input = readForm(formData);

  const employee = await prisma.employee.findFirst({
    // Staff only. The manager has an employee row so attendance has something
    // to point at; it is not somebody work can be handed to.
    where: { id: input.employeeId, active: true, accessRole: "EMPLOYEE" },
    select: { id: true },
  });
  if (!employee) throw new Error("That employee is not available.");

  const task = await prisma.assignedTask.create({
    data: {
      employeeId: input.employeeId,
      title: input.title,
      note: input.note,
      deliverable: input.deliverable,
      acceptance: input.acceptance,
      startDay: input.startDay,
      endDay: input.endDay,
      priority: input.priority,
    },
  });

  await dispatchNotification({
    employeeId: input.employeeId,
    type: "TASK_ASSIGNED",
    title: "New Task Assigned",
    message:
      input.days > 1
        ? `${input.title} — ${input.days} days.`
        : `${input.title} — today's job.`,
    url: jobUrl(task.id),
    dedupeKey: `ASSIGNED_TASK:${task.id}`,
    metadata: { days: input.days },
  }).catch(() => {
    // The work is recorded; a failed push must not undo that.
  });

  refresh();
  return { id: task.id };
}

export async function updateAssignedTask(id: string, formData: FormData) {
  await requireTaskAssigner();
  // A site visit's job follows the visit — see lib/site-visit-task-store.ts.
  await refuseVisitTask(id);
  const input = readForm(formData);

  const before = await prisma.assignedTask.findUnique({
    where: { id },
    select: { employeeId: true, title: true, startDay: true, endDay: true },
  });
  if (!before) throw new Error("That task no longer exists.");

  await prisma.assignedTask.update({
    where: { id },
    data: {
      employeeId: input.employeeId,
      title: input.title,
      note: input.note,
      deliverable: input.deliverable,
      acceptance: input.acceptance,
      startDay: input.startDay,
      endDay: input.endDay,
      priority: input.priority,
    },
  });

  // Handing it to somebody else is an assignment for them, not an edit.
  const movedPerson = before.employeeId !== input.employeeId;
  const movedDays =
    before.startDay.getTime() !== input.startDay.getTime() ||
    before.endDay.getTime() !== input.endDay.getTime();

  if (movedPerson || movedDays || before.title !== input.title) {
    await dispatchNotification({
      employeeId: input.employeeId,
      type: movedPerson ? "TASK_ASSIGNED" : "TASK_UPDATED",
      title: movedPerson ? "New Task Assigned" : "Task Updated",
      message: movedPerson ? `${input.title} — ${input.days} days.` : `"${input.title}" has changed.`,
      url: jobUrl(id),
      // Keyed on what it became, so re-saving the same thing is silent and a
      // real second edit is not.
      dedupeKey: `ASSIGNED_TASK_UPDATE:${id}:${input.employeeId}:${input.title}:${input.startDay.toISOString()}:${input.endDay.toISOString()}`,
    }).catch(() => {});
  }

  refresh();
}

export async function deleteAssignedTask(id: string) {
  await requireTaskAssigner();
  await refuseVisitTask(id);
  await prisma.assignedTask.delete({ where: { id } }).catch(() => {});
  refresh();
}

/**
 * Dragging a job to another day, or onto somebody else.
 *
 * The span moves whole: a two-day job dropped on Wednesday runs Wednesday and
 * Thursday, because the point of picking it up is to say when it happens, not
 * how long it takes. Duration is changed by editing it.
 */
export async function moveAssignedTask(id: string, input: { days: number; employeeId?: string }) {
  await requireTaskAssigner();
  await refuseVisitTask(id);

  const task = await prisma.assignedTask.findUnique({
    where: { id },
    select: { employeeId: true, title: true, startDay: true, endDay: true },
  });
  if (!task) throw new Error("That task no longer exists.");

  const shift = Math.round(input.days);
  const employeeId = input.employeeId ?? task.employeeId;

  if (shift === 0 && employeeId === task.employeeId) return;

  if (employeeId !== task.employeeId) {
    const employee = await prisma.employee.findFirst({
      // Staff only, for the same reason as the guard above.
      where: { id: employeeId, active: true, accessRole: "EMPLOYEE" },
      select: { id: true },
    });
    if (!employee) throw new Error("That employee is not available.");
  }

  const startDay = new Date(task.startDay.getTime() + shift * DAY_MS);
  const endDay = new Date(task.endDay.getTime() + shift * DAY_MS);

  await prisma.assignedTask.update({
    where: { id },
    data: { employeeId, startDay, endDay },
  });

  const days = Math.round((endDay.getTime() - startDay.getTime()) / DAY_MS) + 1;

  await dispatchNotification({
    employeeId,
    type: employeeId === task.employeeId ? "TASK_UPDATED" : "TASK_ASSIGNED",
    title: employeeId === task.employeeId ? "Task moved" : "New Task Assigned",
    message:
      employeeId === task.employeeId
        ? `"${task.title}" moved to ${startDay.toISOString().slice(0, 10)}.`
        : `${task.title} — ${days} ${days === 1 ? "day" : "days"}.`,
    url: jobUrl(id),
    dedupeKey: `ASSIGNED_TASK_MOVE:${id}:${employeeId}:${startDay.toISOString()}`,
  }).catch(() => {});

  refresh();
}

/** The manager ticking one off from the week view. */
export async function setAssignedTaskState(id: string, state: "TODO" | "IN_PROGRESS" | "DONE") {
  await requireTaskAssigner();
  // Approving a visit is done on the visit, where the client's answer is.
  await refuseVisitTask(id);

  const before = await prisma.assignedTask.findUnique({ where: { id }, select: { state: true } });

  // The week board had no runtime check at all: any state could be written from
  // any state. It asks the same rules as everything else now.
  if (before && before.state === state) return;
  if (before) {
    const move = canMove(before.state, state, "manager");
    if (!move.ok) throw new Error(move.reason);
  }

  await prisma.assignedTask.update({
    where: { id },
    data: { state, completedAt: state === "DONE" ? new Date() : null },
  });

  if (before) {
    await recordStateChange({ assignedTaskId: id, from: before.state, to: state, actor: "manager" });
  }

  refresh();
}

// ---------------------------------------------------------------------------
// Handing work out by saying it — see lib/task-dictation.ts.
//
// Two steps on purpose. The first reads the words and creates nothing; the
// second creates what the manager has read and corrected. Both answer with a
// sentence rather than throwing one: a thrown message never reaches the browser
// in production (Next replaces it with a digest), and "the assistant could not
// read that" is exactly the kind of thing the person asking needs to see.

/** Reads what was said into drafts. Creates nothing and tells nobody. */
export async function draftAssignedTasks(words: string): Promise<DictationResult> {
  await requireTaskAssigner();
  return draftTasksFromWords(typeof words === "string" ? words : "");
}

export type AssignDraftsResult =
  | { ok: true; created: number; people: number; skipped: number }
  | { ok: false; error: string };

/**
 * Creates the jobs the manager approved, and tells each person once.
 *
 * What arrives is the list from the browser, so it is read again from nothing:
 * every person is checked against the team as it is now, every day and title
 * re-read. A draft the model produced is not trusted here any more than one
 * typed by hand would be.
 */
export async function assignDraftedTasks(drafts: unknown): Promise<AssignDraftsResult> {
  await requireTaskAssigner();

  const sent = Array.isArray(drafts) ? drafts.slice(0, MAX_DRAFTS) : [];
  if (sent.length === 0) return { ok: false, error: "There is nothing to assign." };

  const team = await prisma.employee.findMany({
    // Staff only, for the same reason as everywhere else in this file.
    where: { active: true, accessRole: "EMPLOYEE" },
    select: { id: true },
  });
  const today = todayKey(await getTimezone());
  const context = { personIds: new Set(team.map((person) => person.id)), todayKey: today };

  const ready = sent.map((draft) => readDraft(draft, context)).filter((draft): draft is TaskDraft => draft !== null);
  if (ready.length === 0) return { ok: false, error: "None of those could be given to anybody on the team." };

  // One at a time: a burst of writes is what the local database falls over on,
  // and the order they were said in is the order they should appear in.
  const made = new Map<string, { ids: string[]; drafts: TaskDraft[] }>();
  for (const draft of ready) {
    const task = await prisma.assignedTask.create({
      data: {
        employeeId: draft.employeeId,
        title: draft.title,
        note: draft.note,
        acceptance: draft.acceptance,
        startDay: dayKeyToDate(draft.startKey),
        endDay: dayKeyToDate(draft.endKey),
        priority: draft.priority,
      },
      select: { id: true },
    });

    const theirs = made.get(draft.employeeId) ?? { ids: [], drafts: [] };
    theirs.ids.push(task.id);
    theirs.drafts.push(draft);
    made.set(draft.employeeId, theirs);
  }

  // Once per person, however many jobs the briefing gave them.
  for (const [employeeId, theirs] of made) {
    const copy = briefingCopy(theirs.drafts, today);
    await dispatchNotification({
      employeeId,
      type: "TASK_ASSIGNED",
      title: copy.title,
      message: copy.message,
      url: theirs.ids.length === 1 ? jobUrl(theirs.ids[0]) : "/employee/tasks",
      dedupeKey: `ASSIGNED_BRIEFING:${theirs.ids[0]}`,
      metadata: { tasks: theirs.ids.length },
    }).catch(() => {
      // The work is recorded; a failed push must not undo that.
    });
  }

  refresh();
  return { ok: true, created: ready.length, people: made.size, skipped: sent.length - ready.length };
}
