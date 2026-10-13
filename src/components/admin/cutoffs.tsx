"use client";

import { useState } from "react";
import { Loader2, Scissors, Undo2 } from "lucide-react";
import { addCutoff, removeCutoff, setTaskCutoff } from "@/lib/actions/deduction-actions";
import { refusalOf } from "@/lib/ask";
import type { Answer } from "@/lib/refusal";
import { cn } from "@/lib/utils";

// Cutoffs: money taken off for a stated reason.
//
// The manager's own — hours of pay or an amount, with the reason the person is
// told — and the automatic ones the nine o'clock rule makes, listed together
// because either kind can be taken back here, one at a time.

type Member = { id: string; name: string };
type Row = {
  id: string;
  employeeName: string;
  kind: string;
  hours: number | null;
  amount: number;
  reason: string;
  dayLabel: string;
  cancelled: boolean;
};

const FIELD = "rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong";

export function Cutoffs({
  team,
  rows,
  ruleOn,
  thisMonth,
}: {
  team: Member[];
  rows: Row[];
  /** Whether a task not handed in by 9 PM costs an hour. */
  ruleOn: boolean;
  /** A cutoff is added to the month being looked at only when that is this month. */
  thisMonth: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<Answer>) {
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
    if (await run("add", () => addCutoff(new FormData(form)))) form.reset();
  }

  return (
    <div>
      <h2 className="mt-10 inline-flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-ink/40">
        <Scissors size={14} strokeWidth={2} />
        Cutoffs
      </h2>
      <p className="mt-1 text-xs text-ink/45">
        Money taken off for a reason. Add one yourself, or take any of them back — the person is told either way.
      </p>

      <div className="glass mt-4 flex flex-wrap items-center gap-3 rounded-2xl p-3">
        <div className="min-w-48 flex-1">
          <p className="text-sm font-medium text-ink">One hour per task not handed in by 9:00 PM</p>
          <p className="text-xs text-ink/50">
            {ruleOn
              ? "On. Everybody is warned at 8:00 PM about tasks due that day and still out; at 9:00 PM each one costs an hour's pay."
              : "Off. Nothing is taken off automatically for a late task."}
          </p>
        </div>
        <button
          type="button"
          disabled={busy != null}
          onClick={() => run("rule", () => setTaskCutoff(!ruleOn))}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60",
            ruleOn ? "border border-ink/12 bg-white/70 text-ink/70 hover:bg-white" : "bg-ink text-bg"
          )}
        >
          {busy === "rule" && <Loader2 size={14} className="animate-spin" />}
          {ruleOn ? "Turn off" : "Turn on"}
        </button>
      </div>

      {thisMonth && (
        <form onSubmit={add} className="glass mt-3 grid gap-2 rounded-2xl p-3 sm:grid-cols-[10rem_6rem_6rem_1fr_auto]">
          <select name="employeeId" required defaultValue="" aria-label="Who" className={FIELD}>
            <option value="" disabled>
              Who
            </option>
            {team.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          <input name="hours" type="number" step="any" min="0" placeholder="Hours" aria-label="Hours of pay" className={FIELD} />
          <input name="amount" type="number" step="any" min="0" placeholder="or JOD" aria-label="Amount in JOD" className={FIELD} />
          <input name="reason" dir="auto" required maxLength={300} placeholder="The reason — they are told it" className={FIELD} />
          <button
            type="submit"
            disabled={busy != null}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-bg disabled:opacity-60"
          >
            {busy === "add" && <Loader2 size={14} className="animate-spin" />}
            Add cutoff
          </button>
        </form>
      )}

      {error && <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700">{error}</p>}

      {rows.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className={cn("glass flex flex-wrap items-center gap-3 rounded-2xl p-3", row.cancelled && "opacity-55")}
            >
              <div className="min-w-40 flex-1">
                <p className="text-sm font-medium text-ink">
                  {row.employeeName}
                  <span className="ml-2 text-xs font-normal text-ink/45">
                    {row.dayLabel} · {row.kind === "TASK" ? "automatic" : "by you"}
                  </span>
                </p>
                <p dir="auto" className={cn("text-xs text-ink/55", row.cancelled && "line-through")}>
                  {row.reason}
                </p>
              </div>
              <p className={cn("text-sm font-semibold text-red-600", row.cancelled && "line-through")}>
                −{row.amount.toFixed(2)} JOD
                {row.hours != null && <span className="ml-1 text-xs font-normal text-ink/45">({row.hours} h)</span>}
              </p>
              {row.cancelled ? (
                <span className="text-xs font-medium text-ink/45">Taken back</span>
              ) : (
                <button
                  type="button"
                  disabled={busy != null}
                  onClick={() => run(row.id, () => removeCutoff(row.id))}
                  className="inline-flex items-center gap-1 rounded-lg border border-ink/12 bg-white/70 px-2.5 py-1.5 text-xs font-medium text-ink/65 hover:bg-white disabled:opacity-60"
                >
                  {busy === row.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} strokeWidth={2} />}
                  Take back
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
