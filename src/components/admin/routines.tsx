"use client";

import { useState } from "react";
import { Loader2, Pause, Play, Plus, Repeat, Trash2 } from "lucide-react";
import { createRoutine, deleteRoutine, setRoutineActive } from "@/lib/actions/routine-actions";
import { refusalOf } from "@/lib/ask";
import { PersonAvatar } from "@/components/chat/person-avatar";
import { cn } from "@/lib/utils";

// Routine tasks: what somebody does every working day.
//
// Written once here; from then on each working day puts it on that person's
// list as an ordinary job — started, photographed, sent for review and approved
// like any other, and on the week board with everything else.

type Member = { id: string; name: string };
type Routine = {
  id: string;
  title: string;
  acceptance: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH";
  active: boolean;
  employee: { id: string; name: string; color: string; photoUrl: string | null; active: boolean };
};

const FIELD = "rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong";

export function Routines({ team, routines }: { team: Member[]; routines: Routine[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, action: () => ReturnType<typeof createRoutine>) {
    if (busy) return false;
    setBusy(key);
    setError(null);
    const refused = await refusalOf(action, "That did not go through. Try again.");
    setBusy(null);
    if (refused) setError(refused);
    return !refused;
  }

  // Not a form action: React empties a form whenever one finishes, refused or not.
  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (await run("add", () => createRoutine(new FormData(form)))) form.reset();
  }

  return (
    <section className="rounded-2xl border border-ink/8 bg-white/70 p-4 sm:p-5">
      <h2 className="inline-flex items-center gap-2 text-base font-semibold text-ink">
        <Repeat size={16} strokeWidth={2} />
        Routine tasks
      </h2>
      <p className="mt-0.5 text-sm text-ink/50">
        Done every working day. Each one is put on that person&apos;s list every morning as a task of its own, due
        that day.
      </p>

      <form onSubmit={add} className="mt-4 grid gap-2 sm:grid-cols-[10rem_1fr_8rem_auto]">
        <select name="employeeId" required defaultValue="" aria-label="Who does it" className={FIELD}>
          <option value="" disabled>
            Who
          </option>
          {team.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
        <input name="title" dir="auto" required maxLength={200} placeholder="What is done every day" className={FIELD} />
        <select name="priority" defaultValue="MEDIUM" aria-label="Priority" className={FIELD}>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
        </select>
        <button
          type="submit"
          disabled={busy != null}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-bg disabled:opacity-60"
        >
          {busy === "add" ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} strokeWidth={2.5} />}
          Add
        </button>
        <input
          name="acceptance"
          dir="auto"
          maxLength={2000}
          placeholder="Counts as done when… (what the day's photo is checked against — optional)"
          className={cn(FIELD, "sm:col-span-4")}
        />
      </form>

      {error && <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700">{error}</p>}

      {routines.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-ink/12 px-3 py-6 text-center text-sm text-ink/40">
          No routine tasks yet.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {routines.map((routine) => (
            <li
              key={routine.id}
              className={cn(
                "flex items-center gap-3 rounded-xl border border-ink/8 bg-white/60 p-2.5",
                !routine.active && "opacity-55"
              )}
            >
              <PersonAvatar
                name={routine.employee.name}
                photo={routine.employee.photoUrl}
                color={routine.employee.color}
                size={28}
              />
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block truncate text-sm font-medium text-ink">
                  {routine.title}
                </span>
                <span className="block truncate text-xs text-ink/45">
                  {routine.employee.name} · every working day
                  {routine.priority === "HIGH" && " · high priority"}
                  {!routine.active && " · paused"}
                  {!routine.employee.active && " · this person's account is off"}
                </span>
              </span>
              <button
                type="button"
                disabled={busy != null}
                onClick={() => run(routine.id, () => setRoutineActive(routine.id, !routine.active))}
                className="inline-flex items-center gap-1 rounded-lg border border-ink/12 bg-white/70 px-2.5 py-1.5 text-xs font-medium text-ink/65 hover:bg-white disabled:opacity-60"
              >
                {routine.active ? <Pause size={13} strokeWidth={2} /> : <Play size={13} strokeWidth={2} />}
                {routine.active ? "Pause" : "Resume"}
              </button>
              <button
                type="button"
                disabled={busy != null}
                aria-label={`Remove ${routine.title}`}
                onClick={() => {
                  if (confirm("Remove this routine task? The days already handed out stay.")) {
                    void run(routine.id, () => deleteRoutine(routine.id));
                  }
                }}
                className="rounded-lg border border-ink/12 bg-white/70 p-1.5 text-ink/50 hover:bg-white hover:text-red-600 disabled:opacity-60"
              >
                <Trash2 size={14} strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
