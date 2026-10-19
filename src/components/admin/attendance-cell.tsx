"use client";

import { useState } from "react";
import { Loader2, Trash2, X } from "lucide-react";
import { editAttendanceDay, removeAttendanceDay } from "@/lib/actions/operations-actions";
import { refusalOf } from "@/lib/ask";
import type { Answer } from "@/lib/refusal";

// One day of the attendance month, editable: click it and set the hours late,
// the hours left early and why, or take the day's record away.
//
// What is saved becomes the manager's (MANUAL): the device never writes over
// it again, which is the point of correcting it — and the reason the box says
// so for a day still in progress, whose clock-out the device would otherwise
// have recorded.

type Entry = {
  delayHours: number;
  earlyHours: number;
  note: string | null;
  source: string;
  clockedOut: boolean;
};

const FIELD = "w-full rounded-lg border border-warm-line bg-white px-3 py-2 text-sm text-bark outline-none focus:border-clay";

export function AttendanceCell({
  employeeId,
  name,
  dayKey,
  entry,
  children,
}: {
  employeeId: string;
  name: string;
  dayKey: string;
  entry: Entry | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The day as the studio's calendar writes it; the key is UTC midnight of it.
  const label = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
    new Date(`${dayKey}T12:00:00Z`)
  );

  async function run(action: () => Promise<Answer>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const refused = await refusalOf(action, "That did not save. Try again.");
    setBusy(false);
    if (refused) setError(refused);
    else setOpen(false);
  }

  // Not a form action: React empties a form whenever one finishes, refused or not.
  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    void run(() => editAttendanceDay(formData));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Change ${name}'s ${label}`}
        className="inline-flex h-7 w-full min-w-[1.75rem] items-center justify-center rounded transition-colors hover:bg-clay-soft"
      >
        {children}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={(event) => event.target === event.currentTarget && !busy && setOpen(false)}
        >
          <form onSubmit={save} className="w-full max-w-sm rounded-2xl bg-card p-5 text-left shadow-xl">
            <input type="hidden" name="employeeId" value={employeeId} />
            <input type="hidden" name="day" value={dayKey} />

            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-bark">{name}</p>
                <p className="text-xs text-bark/50">{label}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1 text-bark/40 hover:bg-clay-soft">
                <X size={16} />
              </button>
            </div>

            <p className="mt-3 text-xs text-bark/50">
              {entry
                ? `Now: ${entry.delayHours}h late · ${entry.earlyHours}h left early${entry.clockedOut ? "" : " · no clock-out"} · ${
                    entry.source === "MANUAL" ? "set by you" : entry.source === "ARRIVAL" ? "arrival set by you" : "from the device"
                  }`
                : "Nothing is recorded for this day."}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-bark/55">Hours late</span>
                <input name="delayHours" type="number" step="any" min="0" max="24" defaultValue={entry?.delayHours ?? 0} className={FIELD} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-bark/55">Hours left early</span>
                <input name="earlyHours" type="number" step="any" min="0" max="24" defaultValue={entry?.earlyHours ?? 0} className={FIELD} />
              </label>
              <label className="col-span-2 block">
                <span className="mb-1 block text-xs font-medium text-bark/55">Note (optional)</span>
                <input name="note" dir="auto" maxLength={200} defaultValue={entry?.note ?? ""} className={FIELD} />
              </label>
            </div>

            <p className="mt-2 text-[11px] text-bark/40">
              Each hour is taken off their pay at their hourly rate. Once you save, the device no longer changes this day.
            </p>

            {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700">{error}</p>}

            <div className="mt-4 flex items-center justify-between gap-2">
              {entry ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Remove ${name}'s record for ${label}?`)) void run(() => removeAttendanceDay(employeeId, dayKey));
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-60"
                >
                  <Trash2 size={14} />
                  Remove the day
                </button>
              ) : (
                <span />
              )}
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-bark px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
