"use client";

import { useState, useTransition } from "react";
import { NotebookPen } from "lucide-react";
import { saveDailyReport } from "@/lib/actions/operations-actions";

// The day in the employee's own words.
//
// Deliberately one box and nothing else. Fields would turn an account of a day
// into a form to fill in, and a form gets filled in with whatever satisfies it
// — which is exactly the thing the platform already has enough of. Everything
// else it knows about a day is inferred; this is the part only the person who
// was there can say.
//
// The box keeps what was already written, because this is edited through the
// day rather than submitted once: somebody remembering at six what they did at
// eleven should find their own words waiting, not an empty box.

export function DailyReport({ today, savedAt }: { today: string; savedAt: Date | null }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <form
      action={(formData) =>
        start(async () => {
          setError(null);
          setSaved(false);
          try {
            await saveDailyReport(formData);
            setSaved(true);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "That did not send.");
          }
        })
      }
      className="glass flex flex-col gap-3 rounded-2xl p-4"
    >
      <div>
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <NotebookPen size={15} strokeWidth={2} />
          Today&apos;s report
        </h2>
        <p className="mt-1 text-xs text-ink/50">
          What you did today, in your own words — including anything that went wrong or is still open. You can keep
          adding to it until the day ends.
        </p>
      </div>

      <textarea
        name="text"
        // dir="auto": written in Arabic as often as English, and it should read
        // in its own direction rather than the page's.
        dir="auto"
        rows={8}
        defaultValue={today}
        required
        placeholder="Went to the Skills site in the morning, took the measurements. The lift was out so the upper floor is still not done…"
        className="rounded-xl border border-ink/12 bg-white/80 px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-cyan-strong"
      />

      {error && <p className="text-xs font-medium text-pink-strong">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="h-11 flex-1 rounded-full bg-ink text-sm font-medium text-bg disabled:opacity-60"
        >
          {pending ? "Sending…" : savedAt ? "Update today's report" : "Send today's report"}
        </button>
      </div>

      {(saved || savedAt) && !pending && (
        <p className="text-center text-xs text-ink/45">
          {saved ? "Sent. You can still add to it." : "Already sent today — editing replaces it."}
        </p>
      )}
    </form>
  );
}
