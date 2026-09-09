"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, Users } from "lucide-react";
import { assignProjectTeam } from "@/lib/actions/task-detail-actions";
import { dotTone } from "@/lib/task-board";
import type { TaskBoardCell, TaskBoardMember, TaskBoardStep } from "@/lib/queries";
import { cn } from "@/lib/utils";

// Who is doing what on this project.
//
// The board's columns are departments, so the people live here instead: one
// row per department, a name against each, decided per project. Wael takes the
// site visit on one job and somebody else takes it on the next, and both are
// true at the same time.

export function ProjectTeamEditor({
  project,
  steps,
  cells,
  team,
  onClose,
}: {
  project: { id: string; name: string; clientName: string };
  steps: TaskBoardStep[];
  cells: TaskBoardCell[];
  team: TaskBoardMember[];
  onClose: () => void;
}) {
  const cellByTask = new Map(cells.map((cell) => [cell.taskId, cell]));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={(formData) => {
        setError(null);
        start(async () => {
          try {
            await assignProjectTeam(project.id, formData);
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "That did not save.");
          }
        });
      }}
      className="flex flex-col gap-3"
    >
      <div className="min-w-0 pr-6">
        <p className="truncate text-sm font-semibold text-ink">{project.name}</p>
        <p className="truncate text-xs text-ink/45">{project.clientName}</p>
      </div>

      <p className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink/40">
        <Users size={11} strokeWidth={2} />
        Who does what here
      </p>

      {steps.length === 0 ? (
        <p className="text-xs text-ink/45">No departments on the board yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {steps.map((step) => {
            const cell = cellByTask.get(step.id);
            const standing = team.find((member) => member.id === step.defaultOwnerId);

            return (
              <li key={step.id}>
                <label className="block">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs font-medium text-ink/70">{step.name}</span>
                    {step.durationDays != null && (
                      <span className="shrink-0 text-[10px] text-ink/35">{step.durationDays}d</span>
                    )}
                  </span>
                  <select
                    name={`assignee:${step.id}`}
                    defaultValue={cell?.assigneeId ?? ""}
                    className="mt-1 w-full rounded-lg border border-ink/12 bg-white px-2 py-1.5 text-sm text-ink outline-none focus:border-cyan-strong"
                  >
                    <option value="">
                      {standing ? `Usually ${standing.name}` : "Nobody yet"}
                    </option>
                    {team.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="text-xs font-medium text-pink-strong">{error}</p>}

      <div className="flex items-center gap-2">
        <Link
          href={`/admin/projects/${project.id}`}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-ink/45 hover:bg-ink/5 hover:text-ink"
        >
          <ExternalLink size={12} strokeWidth={2} />
          Open project
        </Link>
        <button
          type="submit"
          disabled={pending || steps.length === 0}
          className={cn(
            "ml-auto inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-bg hover:bg-ink/85",
            pending && "opacity-70"
          )}
        >
          {pending && <Loader2 size={12} className="animate-spin" />}
          Save team
        </button>
      </div>

      <p className="text-[10px] leading-tight text-ink/35">
        Anyone newly given a step is notified — in the app and, if they have it on, on their devices.
      </p>
    </form>
  );
}

/** The people currently on a project, as coloured initials for the row. */
export function TeamDots({ cells, team }: { cells: TaskBoardCell[]; team: TaskBoardMember[] }) {
  const owners = new Map<string, TaskBoardMember>();
  for (const cell of cells) {
    if (!cell.ownerId) continue;
    const member = team.find((candidate) => candidate.id === cell.ownerId);
    if (member) owners.set(member.id, member);
  }

  const people = [...owners.values()];
  if (people.length === 0) return null;

  return (
    <span className="mt-1 flex items-center gap-1">
      {people.slice(0, 4).map((member) => (
        <span
          key={member.id}
          title={member.name}
          className={cn("h-1.5 w-1.5 rounded-full", dotTone(member.color))}
          aria-hidden
        />
      ))}
      <span className="truncate text-[10px] text-ink/40">
        {people
          .slice(0, 3)
          .map((member) => member.name.split(" ")[0])
          .join(", ")}
        {people.length > 3 ? ` +${people.length - 3}` : ""}
      </span>
    </span>
  );
}
