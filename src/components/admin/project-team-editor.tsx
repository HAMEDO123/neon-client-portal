"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, Users } from "lucide-react";
import { assignProjectTeam } from "@/lib/actions/task-detail-actions";
import { dotTone } from "@/lib/task-board";
import type { TaskBoardCell, TaskBoardMember, TaskBoardSection } from "@/lib/queries";
import { cn } from "@/lib/utils";

// Who is doing what on this project.
//
// A section at a time, not a step at a time: handing somebody "3D
// Visualization" is one decision covering nine boxes, and it is the decision a
// manager actually makes. Wael takes site & procurement on one job and somebody
// else takes it on the next — both are true at once, which is why this lives on
// the project's row rather than in the column header.

export function ProjectTeamEditor({
  project,
  sections,
  team,
  assigned,
  onClose,
}: {
  project: { id: string; name: string; clientName: string };
  sections: TaskBoardSection[];
  team: TaskBoardMember[];
  /** Who currently holds each section here, by section id. */
  assigned: Record<string, string | null>;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const assignable = sections.filter((section) => section.real);

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
        Who takes which section
      </p>

      {assignable.length === 0 ? (
        <p className="text-xs text-ink/45">
          No sections yet — add them in Settings and they appear here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {assignable.map((section) => (
            <li key={section.id}>
              <label className="block">
                <span className="flex items-baseline gap-1.5">
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotTone(section.color))} />
                  <span className="truncate text-xs font-medium text-ink/70">{section.name}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-ink/35">
                    {section.steps.length} {section.steps.length === 1 ? "step" : "steps"}
                  </span>
                </span>
                <select
                  name={`section:${section.id}`}
                  defaultValue={assigned[section.id] ?? ""}
                  className="mt-1 w-full rounded-lg border border-ink/12 bg-white px-2 py-1.5 text-sm text-ink outline-none focus:border-cyan-strong"
                >
                  <option value="">Nobody yet</option>
                  {team.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
            </li>
          ))}
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
          disabled={pending || assignable.length === 0}
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
        Anyone newly given a section is notified — in the app and, if they have it on, on their devices.
      </p>
    </form>
  );
}

/** The people currently on a project, as coloured dots for the row. */
export function TeamDots({ cells, team }: { cells: TaskBoardCell[]; team: TaskBoardMember[] }) {
  const owners = new Map<string, TaskBoardMember>();
  for (const cell of cells) {
    if (!cell.ownerId) continue;
    const member = team.find((candidate) => candidate.id === cell.ownerId);
    if (member) owners.set(member.id, member);
  }

  const people = [...owners.values()];
  if (people.length === 0) return null;

  // Faces rather than a list of names: at a glance the row says how many
  // people are on it and who, without spending the width on words.
  const shown = people.slice(0, 3);

  return (
    <span className="mt-1.5 flex items-center -space-x-1.5">
      {shown.map((member) => (
        <span
          key={member.id}
          title={member.name}
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white ring-2 ring-white",
            dotTone(member.color)
          )}
        >
          {initials(member.name)}
        </span>
      ))}
      {people.length > shown.length && (
        <span
          title={people
            .slice(shown.length)
            .map((member) => member.name)
            .join(", ")}
          className="flex h-5 w-5 items-center justify-center rounded-full bg-ink/10 text-[9px] font-semibold text-ink/55 ring-2 ring-white"
        >
          +{people.length - shown.length}
        </span>
      )}
      <span className="sr-only">{people.map((member) => member.name).join(", ")}</span>
    </span>
  );
}

/** One or two letters standing in for a name. */
function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return letters.toUpperCase() || "?";
}
