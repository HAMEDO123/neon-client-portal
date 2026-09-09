"use client";

import { useMemo, useState, useTransition } from "react";
import { CalendarPlus, Check, ChevronLeft, ChevronRight, Loader2, Trash2, X } from "lucide-react";
import {
  createAssignedTask,
  deleteAssignedTask,
  setAssignedTaskState,
  updateAssignedTask,
} from "@/lib/actions/assigned-task-actions";
import type { AssignedTaskView } from "@/lib/assigned-tasks";
import { dayLabel, placeInWeek, stackRows, weekLabel } from "@/lib/week";
import { dotTone } from "@/lib/task-board";
import { cn } from "@/lib/utils";

// The week of work the manager hands out by hand.
//
// One row per person, one column per day, and a job is a bar across the days it
// runs over — so "two days to go and negotiate" is two filled cells, and what
// somebody's week already looks like is the first thing you see before adding
// to it. Overlapping jobs stack rather than hiding each other.

type Member = { id: string; name: string; color: string; role: string | null };

const PRIORITY_BAR = {
  HIGH: "bg-pink/15 border-pink/30 text-pink-strong",
  MEDIUM: "bg-cyan/15 border-cyan/35 text-cyan-strong",
  LOW: "bg-ink/[0.06] border-ink/15 text-ink/60",
} as const;

export function WeekBoard({
  team,
  tasks,
  weekKeys,
  todayKey,
  onWeek,
}: {
  team: Member[];
  tasks: AssignedTaskView[];
  weekKeys: string[];
  todayKey: string;
  /** Moves the view; the page owns which week is shown, so a link keeps it. */
  onWeek: (weekStartKey: string) => void;
}) {
  const [editing, setEditing] = useState<AssignedTaskView | null>(null);
  const [adding, setAdding] = useState<{ employeeId: string; dayKey: string } | null>(null);
  const [pending, start] = useTransition();

  const byEmployee = useMemo(() => {
    const map = new Map<string, AssignedTaskView[]>();
    for (const task of tasks) {
      const list = map.get(task.employeeId) ?? [];
      list.push(task);
      map.set(task.employeeId, list);
    }
    return map;
  }, [tasks]);

  function run(action: () => Promise<unknown>) {
    start(async () => {
      await action();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-ink">This week</h2>
        <span className="text-sm text-ink/45">{weekLabel(weekKeys)}</span>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => onWeek(shift(weekKeys[0], -7))}
            aria-label="Previous week"
            className="rounded-lg border border-ink/12 bg-white/70 p-1.5 text-ink/60 hover:bg-white"
          >
            <ChevronLeft size={15} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => onWeek(todayKey)}
            className="rounded-lg border border-ink/12 bg-white/70 px-2.5 py-1.5 text-xs font-medium text-ink/60 hover:bg-white"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => onWeek(shift(weekKeys[0], 7))}
            aria-label="Next week"
            className="rounded-lg border border-ink/12 bg-white/70 p-1.5 text-ink/60 hover:bg-white"
          >
            <ChevronRight size={15} strokeWidth={2} />
          </button>
        </div>
      </div>

      <div
        className={cn(
          "overflow-x-auto rounded-2xl border border-ink/8 bg-white/50 transition-opacity",
          pending && "opacity-95"
        )}
      >
        <div className="min-w-[46rem]">
          {/* Header: the seven days. */}
          <div className="grid grid-cols-[11.5rem_repeat(7,1fr)] border-b border-ink/8 bg-bg-soft">
            <div className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-ink/40">Employee</div>
            {weekKeys.map((key) => {
              const label = dayLabel(key);
              const isToday = key === todayKey;
              return (
                <div
                  key={key}
                  className={cn(
                    "border-l border-ink/8 px-2 py-3 text-center",
                    isToday && "bg-cyan/10"
                  )}
                >
                  <p className={cn("text-[11px] font-medium uppercase tracking-wide", isToday ? "text-cyan-strong" : "text-ink/40")}>
                    {label.weekday}
                  </p>
                  <p className={cn("text-sm font-semibold", isToday ? "text-cyan-strong" : "text-ink/70")}>
                    {label.day}
                  </p>
                </div>
              );
            })}
          </div>

          {team.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink/40">
              Add the team first, and their week appears here.
            </p>
          ) : (
            team.map((member) => {
              const mine = byEmployee.get(member.id) ?? [];
              const placed = stackRows(mine);
              const rows = Math.max(1, placed.length ? Math.max(...placed.map((p) => p.row)) + 1 : 1);

              return (
                <div
                  key={member.id}
                  className="grid grid-cols-[11.5rem_repeat(7,1fr)] border-b border-ink/6 last:border-b-0"
                >
                  <div className="flex items-start gap-2 px-4 py-3">
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", dotTone(member.color))} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{member.name}</span>
                      {member.role && <span className="block truncate text-xs text-ink/40">{member.role}</span>}
                    </span>
                  </div>

                  {/* The days, and the bars laid over them. */}
                  <div className="relative col-span-7 grid grid-cols-7">
                    {weekKeys.map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setAdding({ employeeId: member.id, dayKey: key })}
                        aria-label={`Add a task for ${member.name} on ${key}`}
                        className={cn(
                          "group/day border-l border-ink/6 transition-colors hover:bg-cyan/[0.06]",
                          key === todayKey && "bg-cyan/[0.04]"
                        )}
                        style={{ minHeight: `${rows * 2.25 + 1.25}rem` }}
                      >
                        <CalendarPlus
                          size={13}
                          strokeWidth={2}
                          className="mx-auto text-ink/0 transition-colors group-hover/day:text-ink/25"
                        />
                      </button>
                    ))}

                    {placed.map(({ item, row }) => {
                      const place = placeInWeek(item, weekKeys);
                      if (!place) return null;
                      const done = item.state === "DONE";

                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setEditing(item)}
                          title={item.note ?? item.title}
                          className={cn(
                            "absolute flex items-center gap-1.5 overflow-hidden rounded-lg border px-2 text-left text-[11px] font-medium transition-transform active:scale-[0.99]",
                            PRIORITY_BAR[item.priority],
                            done && "opacity-55",
                            place.continuesBefore && "rounded-l-none",
                            place.continuesAfter && "rounded-r-none"
                          )}
                          style={{
                            left: `calc(${(place.startColumn / 7) * 100}% + 3px)`,
                            width: `calc(${(place.span / 7) * 100}% - 6px)`,
                            top: `${row * 2.25 + 0.375}rem`,
                            height: "1.875rem",
                          }}
                        >
                          {done && <Check size={11} strokeWidth={3} className="shrink-0" />}
                          <span className={cn("truncate", done && "line-through")}>{item.title}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <p className="text-xs text-ink/40">
        Click any day to give someone a job, and drag the dates to cover more than one — two days to go and negotiate
        fills two cells. Click a bar to change it.
      </p>

      {(adding || editing) && (
        <TaskDialog
          team={team}
          task={editing}
          initial={adding}
          onClose={() => {
            setAdding(null);
            setEditing(null);
          }}
          onDelete={(id) => {
            setEditing(null);
            run(() => deleteAssignedTask(id));
          }}
          onToggleDone={(task) => {
            setEditing(null);
            run(() => setAssignedTaskState(task.id, task.state === "DONE" ? "TODO" : "DONE"));
          }}
        />
      )}
    </div>
  );
}

/** Writing a job down, or changing one. */
function TaskDialog({
  team,
  task,
  initial,
  onClose,
  onDelete,
  onToggleDone,
}: {
  team: Member[];
  task: AssignedTaskView | null;
  initial: { employeeId: string; dayKey: string } | null;
  onClose: () => void;
  onDelete: (id: string) => void;
  onToggleDone: (task: AssignedTaskView) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const employeeId = task?.employeeId ?? initial?.employeeId ?? team[0]?.id ?? "";
  const startKey = task?.startKey ?? initial?.dayKey ?? "";
  const endKey = task?.endKey ?? initial?.dayKey ?? "";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0" />

      <form
        action={(formData) => {
          setError(null);
          start(async () => {
            try {
              if (task) await updateAssignedTask(task.id, formData);
              else await createAssignedTask(formData);
              onClose();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "That did not save.");
            }
          });
        }}
        className="relative w-full max-w-md rounded-2xl border border-ink/10 bg-white p-4 shadow-[0_24px_60px_-20px_rgba(21,19,31,0.35)]"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">{task ? "Edit task" : "New task"}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink/30 hover:bg-ink/5 hover:text-ink"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        <label className="mt-3 block">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-ink/40">Task</span>
          <input
            name="title"
            defaultValue={task?.title ?? ""}
            autoFocus
            placeholder="Negotiate with the marble supplier"
            className="mt-1 w-full rounded-lg border border-ink/12 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-strong"
          />
        </label>

        <label className="mt-3 block">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-ink/40">For</span>
          <select
            name="employeeId"
            defaultValue={employeeId}
            className="mt-1 w-full rounded-lg border border-ink/12 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-strong"
          >
            {team.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-ink/40">From</span>
            <input
              type="date"
              name="startDay"
              defaultValue={startKey}
              className="mt-1 w-full rounded-lg border border-ink/12 bg-white px-2 py-2 text-sm outline-none focus:border-cyan-strong"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-ink/40">To</span>
            <input
              type="date"
              name="endDay"
              defaultValue={endKey}
              className="mt-1 w-full rounded-lg border border-ink/12 bg-white px-2 py-2 text-sm outline-none focus:border-cyan-strong"
            />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-ink/40">Priority</span>
          <select
            name="priority"
            defaultValue={task?.priority ?? "MEDIUM"}
            className="mt-1 w-full rounded-lg border border-ink/12 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-strong"
          >
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </select>
        </label>

        <label className="mt-3 block">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-ink/40">Notes</span>
          <textarea
            name="note"
            rows={2}
            defaultValue={task?.note ?? ""}
            placeholder="Anything they need to know…"
            className="mt-1 w-full rounded-lg border border-ink/12 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-strong"
          />
        </label>

        {error && <p className="mt-2 text-xs font-medium text-pink-strong">{error}</p>}

        <div className="mt-4 flex items-center gap-2">
          {task && (
            <>
              <button
                type="button"
                onClick={() => onDelete(task.id)}
                aria-label="Delete this task"
                className="rounded-lg p-2 text-red-500/70 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 size={15} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => onToggleDone(task)}
                className="rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-xs font-medium text-ink/70 hover:bg-white"
              >
                {task.state === "DONE" ? "Reopen" : "Mark done"}
              </button>
            </>
          )}

          <button
            type="submit"
            disabled={pending}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-xs font-medium text-bg hover:bg-ink/85 disabled:opacity-60"
          >
            {pending && <Loader2 size={12} className="animate-spin" />}
            {task ? "Save" : "Assign"}
          </button>
        </div>

        <p className="mt-2 text-[10px] leading-tight text-ink/35">
          They are notified — in the app and, if they have it on, on their devices.
        </p>
      </form>
    </div>
  );
}

/** Day arithmetic on a key, without dragging the timezone helpers in here. */
function shift(dayKey: string, days: number) {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
