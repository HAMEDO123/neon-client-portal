import { prisma } from "@/lib/db";
import { taskForEmployee } from "@/lib/employee-tasks";
import { notifyAdmin } from "@/lib/admin-notifications";
import { EMPLOYEE_STATE_LABEL } from "@/lib/task-board";
import { recordStateChange } from "@/lib/task-state-log";
import { canMove } from "@/lib/task-transitions";
import type { TaskState } from "@/generated/prisma/enums";

// An employee moving their own work, for the web action and the mobile API
// both.
//
// This was the body of `setMyTaskStatus`, which takes its employee from a
// session cookie. The app has a Bearer token instead, and what must not be
// written twice is underneath: the `canMove` check, the state log, and telling
// the manager. A second copy would be one more of the six places that write a
// state — the arrangement the README describes as having produced twenty-five
// drifting copies of a guard before.
//
// Not "use server": it takes the employee as an argument, and an export of one
// of those is callable over the network.

export type TaskMover = { id: string; name: string };

/**
 * Moves one of this employee's tasks, or refuses.
 *
 * Returns `moved: false` with a reason rather than throwing on a refusal the
 * caller should show — an employee tapping "start" on work the manager has
 * already approved is not an error, it is an answer. A task that is not theirs
 * matches no rows and is reported as not found, never as someone else's.
 */
export async function moveMyTask(
  employee: TaskMover,
  entryId: string,
  state: TaskState
): Promise<{ moved: boolean; reason?: string }> {
  const task = await taskForEmployee(employee.id, entryId);
  if (!task) return { moved: false, reason: "Task not found." };

  // Already there. Not a refusal and not a write — the board cycles states and
  // lands on the same one often enough that an error here would be wrong.
  if (task.state === state) return { moved: true };

  // Who may move what is decided in one place, so this and the board can never
  // drift apart on it.
  const move = canMove(task.state, state, "employee");
  if (!move.ok) return { moved: false, reason: move.reason };

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

  return { moved: true };
}
