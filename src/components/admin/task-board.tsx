"use client";

import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  Check,
  CalendarCheck,
  CalendarClock,
  Camera,
  ChevronLeft,
  ChevronRight,
  Loader,
  Plus,
  RotateCcw,
  CalendarPlus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  createEmployee,
  createProcessTask,
  deleteEmployee,
  deleteProcessTask,
  moveEmployee,
  moveProcessTask,
  resetProjectTasks,
  setTaskState,
  updateEmployee,
  updateProcessTask,
} from "@/lib/actions/task-actions";
import { NEXT_STATE, STATE_LABEL, columnTone, dotTone, headerTone } from "@/lib/task-board";
import { TaskScheduleEditor, type CellDetails } from "@/components/admin/task-schedule-editor";
import type { TaskBoard as TaskBoardData, TaskBoardGroup } from "@/lib/queries";
import type { TaskState } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

type CellPatch =
  | { kind: "state"; projectId: string; taskId: string; state: TaskState }
  | { kind: "details"; projectId: string; taskId: string; details: CellDetails };

export function TaskBoard({
  board,
  todayKey,
  tomorrowKey,
}: {
  board: TaskBoardData;
  todayKey: string;
  tomorrowKey: string;
}) {
  const [pending, startTransition] = useTransition();
  const [employeeFilter, setEmployeeFilter] = useState<string | null>(null);

  // The action re-renders the page server-side, which would make a tick on a
  // wide board feel laggy. Overlay the pending change locally instead.
  const [rows, applyPatch] = useOptimistic(board.rows, (current, patch: CellPatch) =>
    current.map((row) => {
      if (row.project.id !== patch.projectId) return row;
      return {
        ...row,
        cells: row.cells.map((c) =>
          c.taskId !== patch.taskId
            ? c
            : patch.kind === "state"
              ? { ...c, state: patch.state }
              : { ...c, ...patch.details }
        ),
      };
    })
  );

  const owners = useMemo(
    () => board.groups.filter((g) => g.editable).map((g) => ({ id: g.id, name: g.name })),
    [board.groups]
  );

  // Column indices come from the unfiltered task order, so a filtered view
  // still reads the right cell out of each row's full-width array.
  const columns = useMemo(() => {
    const indexByTask = new Map(board.groups.flatMap((g) => g.tasks).map((t, i) => [t.id, i]));
    return board.groups
      .filter((g) => !employeeFilter || g.id === employeeFilter)
      .map((group) => ({
        group,
        tasks: group.tasks.map((task) => ({ task, index: indexByTask.get(task.id)! })),
      }));
  }, [board.groups, employeeFilter]);

  // Filtering narrows what progress means: looking at one person's columns,
  // a row's total counts their steps only.
  const visibleIndices = useMemo(() => columns.flatMap((c) => c.tasks.map((t) => t.index)), [columns]);

  // Before anyone has been added the board is just a project list, so the one
  // thing to do next gets a labelled column instead of a bare "+".
  const empty = board.groups.length === 0;

  function run(action: () => Promise<unknown>) {
    startTransition(async () => {
      await action();
    });
  }

  function cycle(projectId: string, taskId: string, state: TaskState) {
    const next = NEXT_STATE[state];
    startTransition(async () => {
      applyPatch({ kind: "state", projectId, taskId, state: next });
      await setTaskState(projectId, taskId, next);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-ink/40">
          <Users size={13} strokeWidth={1.75} />
          Team
        </span>
        <FilterChip active={employeeFilter === null} onClick={() => setEmployeeFilter(null)}>
          Everyone
        </FilterChip>
        {board.groups.map((g) => (
          <FilterChip
            key={g.id}
            active={employeeFilter === g.id}
            color={g.editable ? g.color : undefined}
            onClick={() => setEmployeeFilter(employeeFilter === g.id ? null : g.id)}
          >
            {g.name}
          </FilterChip>
        ))}
        <span className="ml-auto hidden items-center gap-3 text-xs text-ink/40 md:flex">
          <Legend state="DONE" />
          <Legend state="SUBMITTED" />
          <Legend state="TOMORROW" />
          <Legend state="TODO" />
        </span>
      </div>

      <div
        className={cn(
          "overflow-x-auto rounded-2xl border border-ink/8 bg-white/50 transition-opacity",
          pending && "opacity-95"
        )}
      >
        <table className="w-full min-w-[46rem] table-fixed border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr>
              <th
                rowSpan={2}
                className="sticky left-0 z-20 w-[10rem] border-b border-ink/8 bg-bg-soft px-3 py-3 text-xs font-medium uppercase tracking-wider text-ink/40 sm:w-[11.5rem] sm:px-4"
              >
                Project
              </th>

              {columns.map(({ group, tasks }) => (
                <th
                  key={group.id}
                  colSpan={tasks.length + (group.editable ? 1 : 0)}
                  className={cn(
                    "relative border-b border-l border-ink/8 px-2 py-2",
                    group.editable ? headerTone(group.color) : "bg-ink/[0.03] text-ink/50"
                  )}
                >
                  {group.editable ? (
                    <EmployeeHeader group={group} run={run} />
                  ) : (
                    <span className="block truncate text-center text-[13px] font-semibold">{group.name}</span>
                  )}
                </th>
              ))}

              {!employeeFilter && (
                <th
                  rowSpan={2}
                  className={cn(
                    "border-b border-l border-ink/8 bg-bg-soft p-0 align-middle",
                    empty ? "w-full" : "w-8"
                  )}
                >
                  <InlineAdd
                    title="Add a team member"
                    placeholder="Name"
                    label={empty ? "Add your first team member" : undefined}
                    onSubmit={(value) => run(() => createEmployee(value))}
                  />
                </th>
              )}

              {!empty && (
                <th
                  rowSpan={2}
                  className="w-[5.5rem] border-b border-l border-ink/8 bg-bg-soft px-2 py-3 text-center text-xs font-medium uppercase tracking-wider text-ink/40"
                >
                  Progress
                </th>
              )}
            </tr>

            <tr>
              {columns.flatMap(({ group, tasks }) => [
                ...tasks.map(({ task }, i) => (
                  <th
                    key={task.id}
                    className={cn(
                      "relative min-w-[3.25rem] border-b border-ink/8 p-0 align-bottom",
                      i === 0 && "border-l border-ink/8",
                      group.editable && columnTone(group.color)
                    )}
                  >
                    <TaskHeader task={task} ownerId={group.editable ? group.id : ""} owners={owners} run={run} />
                  </th>
                )),
                ...(group.editable
                  ? [
                      <th
                        key={`${group.id}-add`}
                        className={cn(
                          "border-b border-ink/8 p-0 align-bottom",
                          // A person with no steps yet has only this column to
                          // carry their name, so it gets room to show it.
                          tasks.length === 0 ? "w-24 border-l border-ink/8" : "w-8",
                          columnTone(group.color)
                        )}
                      >
                        <InlineAdd
                          title={`Add a step for ${group.name}`}
                          placeholder="Step"
                          onSubmit={(value) => run(() => createProcessTask(value, group.id))}
                        />
                      </th>,
                    ]
                  : []),
              ])}
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              // "Not counted" cells drop out of the fraction entirely, so a
              // step that never applied to this project cannot hold the row
              // below 100%.
              const counted = visibleIndices
                .map((i) => row.cells[i])
                .filter((cell) => !cell?.excludedFromProgress);
              const done = counted.filter((cell) => cell?.state === "DONE").length;
              const tomorrow = counted.filter((cell) => cell?.state === "TOMORROW").length;

              return (
                <tr key={row.project.id} className="group/row">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-ink/6 bg-white px-3 py-2.5 text-left font-normal group-hover/row:bg-bg-soft/80 sm:px-4"
                  >
                    <Link href={`/admin/projects/${row.project.id}`} className="block min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{row.project.name}</span>
                      <span className="block truncate text-xs text-ink/45">{row.project.clientName}</span>
                    </Link>
                  </th>

                  {columns.flatMap(({ group, tasks }) => [
                    ...tasks.map(({ task, index }, i) => {
                      const cell = row.cells[index];
                      const state = cell?.state ?? "TODO";
                      return (
                        <td
                          key={task.id}
                          className={cn(
                            "group/cell relative border-b border-ink/6 p-0 text-center",
                            i === 0 && "border-l border-ink/8",
                            group.editable && columnTone(group.color)
                          )}
                        >
                          <TaskCell
                            state={state}
                            excluded={cell?.excludedFromProgress ?? false}
                            label={`${task.name} · ${row.project.name}`}
                            onClick={() => cycle(row.project.id, task.id, state)}
                          />
                          <CellSchedule
                            projectId={row.project.id}
                            projectName={row.project.name}
                            taskId={task.id}
                            taskName={task.name}
                            details={{
                              priority: cell?.priority ?? "MEDIUM",
                              scheduledFor: cell?.scheduledFor ?? null,
                              dueAt: cell?.dueAt ?? null,
                              adminNote: cell?.adminNote ?? null,
                              assigneeId: cell?.assigneeId ?? null,
                              excludedFromProgress: cell?.excludedFromProgress ?? false,
                            }}
                            onSaved={(details) =>
                              applyPatch({ kind: "details", projectId: row.project.id, taskId: task.id, details })
                            }
                            owners={owners}
                            defaultOwnerId={group.editable ? group.id : null}
                            todayKey={todayKey}
                            tomorrowKey={tomorrowKey}
                          />
                        </td>
                      );
                    }),
                    ...(group.editable
                      ? [
                          <td
                            key={`${group.id}-add`}
                            className={cn(
                              "border-b border-ink/6",
                              tasks.length === 0 && "border-l border-ink/8",
                              columnTone(group.color)
                            )}
                          />,
                        ]
                      : []),
                  ])}

                  {!employeeFilter && <td className="border-b border-l border-ink/8 bg-bg-soft/40" />}

                  {!empty && (
                  <td className="border-b border-l border-ink/8 px-1.5 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <ProgressPill done={done} total={counted.length} tomorrow={tomorrow} />
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Clear every tick on “${row.project.name}”?`)) {
                            run(() => resetProjectTasks(row.project.id));
                          }
                        }}
                        aria-label={`Clear all ticks on ${row.project.name}`}
                        title="Clear this row"
                        className="rounded-md p-1 text-ink/25 opacity-0 transition-opacity hover:bg-ink/5 hover:text-ink/60 focus-visible:opacity-100 group-hover/row:opacity-100"
                      >
                        <RotateCcw size={13} strokeWidth={1.75} />
                      </button>
                    </div>
                  </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink/40">
        {empty ? (
          <>
            Add each person on the team, then the steps they own. Every project above gets the same steps, and everyone
            ticks off their own column.
          </>
        ) : (
          <>
            Click a box to cycle it: to do → done → tomorrow. Use{" "}
            <span className="font-medium text-ink/60">+</span> in the header to add a person or one of their steps, and
            click any header to rename, reassign or remove it.
          </>
        )}
      </p>
    </div>
  );
}

function TaskCell({
  state,
  label,
  excluded,
  onClick,
}: {
  state: TaskState;
  label: string;
  excluded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} — ${STATE_LABEL[state]}${excluded ? ", not counted" : ""}. Click to change.`}
      title={`${label}\n${STATE_LABEL[state]}${excluded ? " · not counted towards progress" : ""} — click to change`}
      className={cn(
        "flex h-11 w-full items-center justify-center transition-colors hover:bg-ink/[0.05]",
        // Still tickable, just visibly out of the count.
        excluded && "opacity-40"
      )}
    >
      <span
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-md border transition-colors",
          state === "DONE" && "border-emerald-500/30 bg-emerald-500/15 text-emerald-700",
          state === "IN_PROGRESS" && "border-cyan/40 bg-cyan/15 text-cyan-strong",
          // Waiting on the manager: it looks unlike anything they set themselves.
          state === "SUBMITTED" && "border-purple/40 bg-purple/15 text-purple-strong",
          state === "TOMORROW" && "border-amber-500/30 bg-amber-500/15 text-amber-700",
          state === "TODO" && "border-ink/15 bg-white/70"
        )}
      >
        {state === "DONE" && <Check size={14} strokeWidth={3} />}
        {state === "IN_PROGRESS" && <Loader size={13} strokeWidth={2.5} />}
        {state === "SUBMITTED" && <Camera size={13} strokeWidth={2.25} />}
        {state === "TOMORROW" && <CalendarClock size={13} strokeWidth={2.25} />}
      </span>
    </button>
  );
}

// Sits in the corner of a cell: a calendar once the task has a date, and the
// scheduling editor on click. The cell's main click still cycles the status,
// so the board's existing rhythm is untouched.
function CellSchedule({
  projectId,
  projectName,
  taskId,
  taskName,
  details,
  owners,
  defaultOwnerId,
  todayKey,
  tomorrowKey,
  onSaved,
}: {
  projectId: string;
  projectName: string;
  taskId: string;
  taskName: string;
  details: CellDetails;
  owners: { id: string; name: string }[];
  defaultOwnerId: string | null;
  todayKey: string;
  tomorrowKey: string;
  onSaved: (details: CellDetails) => void;
}) {
  const [open, setOpen] = useState(false);
  const scheduled = Boolean(details.scheduledFor);
  const urgent = scheduled && details.priority === "HIGH";

  return (
    <span className="absolute right-0.5 top-0.5">
      <Popover
        open={open}
        onOpenChange={setOpen}
        align="end"
        width={EDITOR_WIDTH}
        triggerLabel={`Schedule ${taskName} on ${projectName}`}
        triggerClassName={cn(
          "flex h-4 w-4 items-center justify-center rounded transition-opacity hover:bg-ink/10 focus-visible:opacity-100",
          // A scheduled cell wears its date openly: the marker is what tells
          // you the step has a day on it, so it stays visible and reads as a
          // calendar rather than a stray dot.
          scheduled
            ? cn("opacity-100", urgent ? "text-pink" : "text-cyan-strong")
            : "text-ink/30 opacity-0 hover:text-ink group-hover/cell:opacity-100"
        )}
        trigger={
          scheduled ? <CalendarCheck size={11} strokeWidth={2.5} /> : <CalendarPlus size={10} strokeWidth={2.25} />
        }
      >
        <TaskScheduleEditor
          projectId={projectId}
          projectName={projectName}
          taskId={taskId}
          taskName={taskName}
          details={details}
          owners={owners}
          defaultOwnerId={defaultOwnerId}
          todayKey={todayKey}
          tomorrowKey={tomorrowKey}
          onClose={() => setOpen(false)}
          onSaved={onSaved}
        />
      </Popover>
    </span>
  );
}

function ProgressPill({ done, total, tomorrow }: { done: number; total: number; tomorrow: number }) {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <span
      className="inline-flex flex-col items-center gap-1"
      // The raw count still matters when you are deciding what to pick up, so
      // it stays one hover away rather than taking room in the column.
      title={`${done} of ${total} steps done`}
    >
      <span className="text-xs font-semibold text-ink/70">{percent}%</span>
      <span className="block h-1.5 w-14 overflow-hidden rounded-full bg-ink/8">
        <span className="block h-full rounded-full bg-emerald-500/70 transition-all" style={{ width: `${percent}%` }} />
      </span>
      {tomorrow > 0 && <span className="text-[10px] leading-none text-amber-700">{tomorrow} tomorrow</span>}
    </span>
  );
}

// Both header editors open in place, so adding and fixing columns never leaves
// the board.
function EmployeeHeader({ group, run }: { group: TaskBoardGroup; run: (action: () => Promise<unknown>) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(group.name);
  const [role, setRole] = useState(group.role ?? "");

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName(group.name);
          setRole(group.role ?? "");
        }
      }}
      trigger={
        <span className="block w-full px-1">
          <span className="block break-words text-center text-[13px] font-semibold">{group.name}</span>
          {group.role && (
            <span className="block truncate text-center text-[11px] font-normal opacity-70">{group.role}</span>
          )}
        </span>
      }
      triggerLabel={`Edit ${group.name}`}
    >
      <PopoverField label="Name" value={name} onChange={setName} autoFocus />
      <PopoverField label="Role" value={role} onChange={setRole} placeholder="3D Visualizer" />

      <div className="mt-3 flex items-center gap-1">
        <button
          type="button"
          onClick={() => run(() => moveEmployee(group.id, "left"))}
          aria-label="Move left"
          className="rounded-md p-1.5 text-ink/40 hover:bg-ink/5 hover:text-ink"
        >
          <ChevronLeft size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => run(() => moveEmployee(group.id, "right"))}
          aria-label="Move right"
          className="rounded-md p-1.5 text-ink/40 hover:bg-ink/5 hover:text-ink"
        >
          <ChevronRight size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Remove ${group.name}? Their steps stay on the board as unassigned.`)) {
              setOpen(false);
              run(() => deleteEmployee(group.id));
            }
          }}
          aria-label={`Remove ${group.name}`}
          className="rounded-md p-1.5 text-red-500/70 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => {
            if (!name.trim()) return;
            setOpen(false);
            run(() => updateEmployee(group.id, name, role));
          }}
          className="ml-auto rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-bg hover:bg-ink/85"
        >
          Save
        </button>
      </div>
    </Popover>
  );
}

// Hyphenate first, break as a last resort: a long step name should read as
// "Require-ments", but it must never overflow into the neighbouring column,
// which is what happens if nothing can break it at all.
function TaskHeader({
  task,
  ownerId,
  owners,
  run,
}: {
  task: { id: string; name: string };
  ownerId: string;
  owners: { id: string; name: string }[];
  run: (action: () => Promise<unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(task.name);
  const [owner, setOwner] = useState(ownerId);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName(task.name);
          setOwner(ownerId);
        }
      }}
      trigger={
        <span className="block hyphens-auto break-words px-0.5 py-2 text-center text-[10px] font-medium leading-[1.25] tracking-tight text-ink/60">
          {task.name}
        </span>
      }
      triggerLabel={`Edit ${task.name}`}
      align="center"
    >
      <PopoverField label="Step" value={name} onChange={setName} autoFocus />

      <label className="mt-2 block text-[11px] font-medium uppercase tracking-wider text-ink/40">Owner</label>
      <select
        value={owner}
        onChange={(e) => setOwner(e.target.value)}
        className="mt-1 w-full rounded-lg border border-ink/12 bg-white px-2 py-1.5 text-sm text-ink outline-none focus:border-cyan-strong"
      >
        <option value="">Unassigned</option>
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>

      <div className="mt-3 flex items-center gap-1">
        <button
          type="button"
          onClick={() => run(() => moveProcessTask(task.id, "left"))}
          aria-label="Move left"
          className="rounded-md p-1.5 text-ink/40 hover:bg-ink/5 hover:text-ink"
        >
          <ChevronLeft size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => run(() => moveProcessTask(task.id, "right"))}
          aria-label="Move right"
          className="rounded-md p-1.5 text-ink/40 hover:bg-ink/5 hover:text-ink"
        >
          <ChevronRight size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Delete “${task.name}”? Its ticks on every project go with it.`)) {
              setOpen(false);
              run(() => deleteProcessTask(task.id));
            }
          }}
          aria-label={`Delete ${task.name}`}
          className="rounded-md p-1.5 text-red-500/70 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => {
            if (!name.trim()) return;
            setOpen(false);
            run(() => updateProcessTask(task.id, name, owner || null));
          }}
          className="ml-auto rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-bg hover:bg-ink/85"
        >
          Save
        </button>
      </div>
    </Popover>
  );
}

function InlineAdd({
  title,
  placeholder,
  label,
  onSubmit,
}: {
  title: string;
  placeholder: string;
  label?: string;
  onSubmit: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  function commit() {
    if (value.trim()) onSubmit(value.trim());
    setValue("");
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setValue("");
      }}
      align="end"
      trigger={
        <span
          className={cn(
            "flex h-full w-full items-center justify-center gap-1.5 py-3 text-ink/35",
            label && "px-4 text-xs font-medium text-ink/55"
          )}
        >
          <Plus size={15} strokeWidth={2} />
          {label}
        </span>
      }
      triggerLabel={title}
    >
      <PopoverField
        label={title}
        value={value}
        onChange={setValue}
        placeholder={placeholder}
        autoFocus
        onEnter={commit}
      />
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={commit}
          className="rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-bg hover:bg-ink/85"
        >
          Add
        </button>
      </div>
    </Popover>
  );
}

function PopoverField({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-ink/40">{label}</span>
      <input
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
        className="mt-1 w-full rounded-lg border border-ink/12 bg-white px-2 py-1.5 text-sm text-ink outline-none focus:border-cyan-strong"
      />
    </label>
  );
}

const POPOVER_WIDTH = 224; // w-56
const EDITOR_WIDTH = 272;
// However cramped the window, a panel never shrinks below this — it scrolls.
const MIN_PANEL_HEIGHT = 200;

// A header cell is only ~96px wide, so its editor floats above the table. The
// board scrolls sideways, and a horizontal overflow container clips vertically
// too — so the panel is portalled to the body and positioned against the
// trigger rather than nested inside the scrolling cell.
function Popover({
  open,
  onOpenChange,
  trigger,
  triggerLabel,
  align = "start",
  width = POPOVER_WIDTH,
  triggerClassName,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  triggerLabel: string;
  align?: "start" | "center" | "end";
  width?: number;
  triggerClassName?: string;
  children: React.ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    // Written straight to the node: the panel is positioned against a cell that
    // scrolls, so this runs on every scroll frame and never needs a re-render.
    function place() {
      const panel = panelRef.current;
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!panel || !rect) return;

      const margin = 8;
      const offset = align === "end" ? rect.width - width : align === "center" ? (rect.width - width) / 2 : 0;
      panel.style.left = `${Math.max(margin, Math.min(rect.left + offset, window.innerWidth - width - margin))}px`;

      // The scheduling editor is far taller than the cell that opens it, and
      // the board sits low on the page — hung under its trigger it ran off the
      // bottom of the window, taking the Save button with it. Measure first,
      // then hang it wherever there is more room and cap it to that, so the
      // whole form is always reachable and scrolls inside itself if it must.
      panel.style.maxHeight = "none";
      const height = panel.scrollHeight;
      const below = window.innerHeight - rect.bottom - margin * 2;
      const above = rect.top - margin * 2;

      if (height <= below || below >= above) {
        panel.style.top = `${rect.bottom + 4}px`;
        panel.style.maxHeight = `${Math.max(below, MIN_PANEL_HEIGHT)}px`;
      } else {
        const capped = Math.min(height, above);
        panel.style.top = `${Math.max(margin, rect.top - capped - 4)}px`;
        panel.style.maxHeight = `${Math.max(above, MIN_PANEL_HEIGHT)}px`;
      }

      panel.style.visibility = "visible";
    }

    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) onOpenChange(false);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }

    place();
    // Capture phase so the board's own horizontal scrolling moves the panel too.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, align, width, onOpenChange]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={triggerLabel}
        aria-expanded={open}
        title={triggerLabel}
        onClick={() => onOpenChange(!open)}
        className={
          triggerClassName ??
          "block w-full cursor-pointer rounded-md text-left transition-colors hover:bg-ink/[0.06]"
        }
      >
        {trigger}
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            style={{ width, visibility: "hidden" }}
            // Solid rather than glass: this is a form to fill in, and the board
            // showing through it made the fields hard to read. z-50 keeps it
            // above the sticky header and the first sticky column.
            className="fixed z-50 overflow-y-auto overscroll-contain rounded-xl border border-ink/10 bg-white p-3 text-left text-sm font-normal normal-case tracking-normal text-ink shadow-[0_16px_40px_-14px_rgba(21,19,31,0.28)]"
          >
            <button
              type="button"
              aria-label="Close"
              onClick={() => onOpenChange(false)}
              className="absolute right-2 top-2 rounded-md p-1 text-ink/30 hover:bg-ink/5 hover:text-ink"
            >
              <X size={12} strokeWidth={2} />
            </button>
            {children}
          </div>,
          document.body
        )}
    </>
  );
}

function FilterChip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active ? "border-ink bg-ink text-bg" : "border-ink/12 bg-white/60 text-ink/60 hover:text-ink"
      )}
    >
      {color && <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-bg" : dotTone(color))} />}
      {children}
    </button>
  );
}

function Legend({ state }: { state: TaskState }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded border",
          state === "DONE" && "border-emerald-500/30 bg-emerald-500/15 text-emerald-700",
          state === "SUBMITTED" && "border-purple/40 bg-purple/15 text-purple-strong",
          state === "TOMORROW" && "border-amber-500/30 bg-amber-500/15 text-amber-700",
          state === "TODO" && "border-ink/15 bg-white/70"
        )}
      >
        {state === "DONE" && <Check size={10} strokeWidth={3} />}
        {state === "SUBMITTED" && <Camera size={9} strokeWidth={2.5} />}
        {state === "TOMORROW" && <CalendarClock size={9} strokeWidth={2.5} />}
      </span>
      {STATE_LABEL[state]}
    </span>
  );
}
