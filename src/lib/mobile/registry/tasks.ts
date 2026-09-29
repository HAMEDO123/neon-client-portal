import { requireAdmin, requireTaskAssigner } from "@/lib/admin-guard";
import {
  guarded,
  guardedAction,
  num,
  oneOf,
  optParam,
  optStr,
  str,
  type ActionRegistry,
  type ReadRegistry,
} from "@/lib/mobile/rpc";
import { mobileTaskBoard } from "@/lib/mobile/tasks-board";
import { mobileProcess } from "@/lib/mobile/tasks-process";
import { mobileTaskPeople } from "@/lib/mobile/tasks-people";
import { PEOPLE_PERIODS } from "@/lib/mobile/tasks-people-rules";
import { mobileWeekBoard } from "@/lib/mobile/tasks-week";
import {
  createEmployee,
  createProcessSection,
  createProcessTask,
  deleteEmployee,
  deleteProcessSection,
  deleteProcessTask,
  deleteStagePeriod,
  moveEmployee,
  moveProcessSection,
  moveProcessTask,
  resetProjectTasks,
  saveStagePeriod,
  saveTaskType,
  setTaskSection,
  setTaskState,
  updateEmployee,
  updateProcessSection,
  updateProcessTask,
} from "@/lib/actions/task-actions";
import { clearTaskEntryDetails, updateTaskEntryDetails } from "@/lib/actions/task-detail-actions";
import {
  createAssignedTask,
  deleteAssignedTask,
  moveAssignedTask,
  setAssignedTaskState,
  updateAssignedTask,
} from "@/lib/actions/assigned-task-actions";
import type { TaskState } from "@/generated/prisma/enums";

// The "tasks" area of the phone API. See lib/mobile/rpc.ts: keys are
// "tasks/<name>"; every read is guarded(<the website page's guard>, …); an
// action calls the website's own server action, or is guardedAction(…) when
// it calls a lib function directly.
//
// The manager's project board, the week board (jobs handed out by hand) and
// the delivery process (settings) — /admin/tasks and the process parts of
// /admin/settings, both behind requireAdmin like the pages themselves,
// except the week-board jobs, which the website already lets a ticked
// non-manager hand out (requireTaskAssigner, lib/admin-guard.ts).

const DIRECTIONS = ["left", "right"] as const;
const BOARD_STATES = ["TODO", "DONE", "TOMORROW"] as const;
const JOB_STATES = ["TODO", "IN_PROGRESS", "DONE"] as const;

export const reads: ReadRegistry = {
  "tasks/board": guarded(requireAdmin, async () => mobileTaskBoard()),
  "tasks/week": guarded(requireAdmin, async (params) => mobileWeekBoard(optParam(params, "week"))),
  "tasks/process": guarded(requireAdmin, async () => mobileProcess()),
  // Each person's share of the work they were given this week or month that
  // is done — the Team segment. Behind requireAdmin, like /admin/tasks and
  // /admin/analytics, whose figures it counts by.
  "tasks/people": guarded(requireAdmin, async (params) =>
    mobileTaskPeople(oneOf(optParam(params, "period") ?? "week", PEOPLE_PERIODS, "period"), optParam(params, "day"))
  ),
};

export const actions: ActionRegistry = {
  // --- The board -------------------------------------------------------------

  "tasks/setState": guardedAction(requireAdmin, async (input) => {
    await setTaskState(
      str(input.args[0], "projectId"),
      str(input.args[1], "taskId"),
      oneOf<TaskState>(input.args[2], BOARD_STATES, "state")
    );
  }),

  "tasks/resetProject": guardedAction(requireAdmin, async (input) => {
    await resetProjectTasks(str(input.args[0], "projectId"));
  }),

  // The cell editor: detail, scheduling, priority and the "waits for" list —
  // the whole form is one FormData, exactly as the website posts it.
  "tasks/updateCellDetails": guardedAction(requireAdmin, async (input) => {
    await updateTaskEntryDetails(str(input.args[0], "projectId"), str(input.args[1], "taskId"), input.form);
  }),

  "tasks/clearCellDetails": guardedAction(requireAdmin, async (input) => {
    await clearTaskEntryDetails(str(input.args[0], "projectId"), str(input.args[1], "taskId"));
  }),

  // --- Owners: who is on the board (settings) ---------------------------------

  "tasks/createOwner": guardedAction(requireAdmin, async (input) => {
    await createEmployee(str(input.args[0], "name"));
  }),

  "tasks/updateOwner": guardedAction(requireAdmin, async (input) => {
    await updateEmployee(str(input.args[0], "id"), str(input.args[1], "name"), optStr(input.args[2]) ?? "");
  }),

  "tasks/deleteOwner": guardedAction(requireAdmin, async (input) => {
    await deleteEmployee(str(input.args[0], "id"));
  }),

  "tasks/moveOwner": guardedAction(requireAdmin, async (input) => {
    await moveEmployee(str(input.args[0], "id"), oneOf(input.args[1], DIRECTIONS, "direction"));
  }),

  // --- Sections ----------------------------------------------------------------

  "tasks/createSection": guardedAction(requireAdmin, async (input) => {
    await createProcessSection(str(input.args[0], "name"));
  }),

  "tasks/updateSection": guardedAction(requireAdmin, async (input) => {
    await updateProcessSection(str(input.args[0], "id"), str(input.args[1], "name"), str(input.args[2], "color"));
  }),

  "tasks/deleteSection": guardedAction(requireAdmin, async (input) => {
    await deleteProcessSection(str(input.args[0], "id"));
  }),

  "tasks/moveSection": guardedAction(requireAdmin, async (input) => {
    await moveProcessSection(str(input.args[0], "id"), oneOf(input.args[1], DIRECTIONS, "direction"));
  }),

  // --- Steps ---------------------------------------------------------------

  "tasks/createStep": guardedAction(requireAdmin, async (input) => {
    await createProcessTask(str(input.args[0], "name"), optStr(input.args[1]), optStr(input.args[2]));
  }),

  "tasks/updateStep": guardedAction(requireAdmin, async (input) => {
    await updateProcessTask(
      str(input.args[0], "id"),
      str(input.args[1], "name"),
      optStr(input.args[2]),
      optStr(input.args[3])
    );
  }),

  "tasks/deleteStep": guardedAction(requireAdmin, async (input) => {
    await deleteProcessTask(str(input.args[0], "id"));
  }),

  "tasks/moveStep": guardedAction(requireAdmin, async (input) => {
    await moveProcessTask(str(input.args[0], "id"), oneOf(input.args[1], DIRECTIONS, "direction"));
  }),

  "tasks/setStepSection": guardedAction(requireAdmin, async (input) => {
    await setTaskSection(str(input.args[0], "taskId"), optStr(input.args[1]));
  }),

  // What each kind of work needs: the standard a step carries, which a board
  // cell may still override.
  "tasks/saveType": guardedAction(requireAdmin, async (input) => {
    await saveTaskType(str(input.args[0], "id"), input.form);
  }),

  // --- Stage periods ---------------------------------------------------------

  "tasks/savePeriod": guardedAction(requireAdmin, async (input) => {
    await saveStagePeriod(input.form);
  }),

  "tasks/deletePeriod": guardedAction(requireAdmin, async (input) => {
    await deleteStagePeriod(str(input.args[0], "id"));
  }),

  // --- The week board: jobs handed out by hand --------------------------------

  "tasks/createJob": guardedAction(requireTaskAssigner, async (input) => createAssignedTask(input.form)),

  "tasks/updateJob": guardedAction(requireTaskAssigner, async (input) => {
    await updateAssignedTask(str(input.args[0], "id"), input.form);
  }),

  "tasks/deleteJob": guardedAction(requireTaskAssigner, async (input) => {
    await deleteAssignedTask(str(input.args[0], "id"));
  }),

  "tasks/moveJob": guardedAction(requireTaskAssigner, async (input) => {
    const id = str(input.args[0], "id");
    const days = num(input.args[1], "days");
    const employeeId = optStr(input.args[2]);
    await moveAssignedTask(id, employeeId ? { days, employeeId } : { days });
  }),

  "tasks/setJobState": guardedAction(requireTaskAssigner, async (input) => {
    await setAssignedTaskState(str(input.args[0], "id"), oneOf(input.args[1], JOB_STATES, "state"));
  }),
};
