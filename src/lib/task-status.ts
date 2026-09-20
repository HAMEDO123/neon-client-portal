import { prisma } from "@/lib/db";
import { taskForEmployee } from "@/lib/employee-tasks";
import { notifyAdmin } from "@/lib/admin-notifications";
import { EMPLOYEE_STATE_LABEL } from "@/lib/task-board";
import { recordStateChange } from "@/lib/task-state-log";
import { canMove } from "@/lib/task-transitions";
import type { TaskState } from "@/generated/prisma/enums";

// An employee moving their own work, from wherever they are.
//
// This was inside the server action, which the phone app cannot call. Moving a
// task is not an update — it asks `canMove` whether the move is legal at all,
// writes a TaskStateChange so "when did this actually start" has an answer, and
// tells the manager. Those are rules, and rules that exist twice drift.
//
// The caller supplies the employee, because each one resolves identity its own
// way: the web from a signed cookie, the app from a bearer token. Neither takes
// it from an argument the client sent.
//
// Not "use server": every export of one of those is callable over the network.

export type StateChangeResult = { ok: true; changed: boolean } | { ok: false; error: string };

export async function setEmployeeTaskState(
  employee: { id: string; name: string },
  entryId: string,
  state: TaskState
): Promise<StateChangeResult> {
  // Scoped by ownership: an id belonging to somebody else matches nothing.
  const task = await taskForEmployee(employee.id, entryId);
  if (!task) return { ok: false, error: "Task not found." };

  // A move that changes nothing is not an error — the board cycles states and
  // lands on the same one often enough that throwing here would be wrong.
  if (task.state === state) return { ok: true, changed: false };

  const move = canMove(task.state, state, "employee");
  if (!move.ok) return { ok: false, error: move.reason };

  await prisma.projectTaskEntry.update({
    where: { id: task.id },
    data: {
      state,
      completedAt: null,
      startedAt: state === "IN_PROGRESS" ? (task.startedAt ?? new Date()) : task.startedAt,
    },
  });

  await recordStateChange({
    entryId: task.id,
    from: task.state,
    to: state,
    actor: "employee",
    actorEmployeeId: employee.id,
  });

  await notifyAdmin({
    type: "TASK_STATUS_CHANGED",
    title: `${employee.name}: ${EMPLOYEE_STATE_LABEL[state]}`,
    message: `${task.task.name} — ${task.project.name} moved from ${EMPLOYEE_STATE_LABEL[task.state]} to ${EMPLOYEE_STATE_LABEL[state]}.`,
    url: "/admin/tasks",
    dedupeKey: `TASK_STATUS:${task.id}:${state}:${Date.now()}`,
    entryId: task.id,
    employeeId: employee.id,
  });

  return { ok: true, changed: true };
}
