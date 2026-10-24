"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { NotebookPen, Plus } from "lucide-react";
import { addToDailyReport } from "@/lib/actions/operations-actions";
import { shownError } from "@/lib/refusal";

// Today's report, written as the day happens.
//
// The report already existed as one long box on another page, and that is the
// wrong moment for it: by six o'clock the morning has gone, and a day written
// from memory at the end of it is the day somebody can still remember. This is
// the same text — one line added each time something is finished, where the
// person already is.
//
// The long box still edits the whole thing afterwards, so nothing here is a
// second report: it is the same one, written in pieces.

export function ReportLines({ lines }: { lines: string[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);
  const router = useRouter();

  return (
    <section aria-label="Today's report" className="rounded-2xl border border-warm-line bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <NotebookPen size={15} strokeWidth={2} />
          Today&apos;s report
        </h2>
        {lines.length > 0 && (
          <Link href="/employee/requests" className="text-xs font-medium text-cyan-strong">
            Edit it all
          </Link>
        )}
      </div>

      {lines.length === 0 ? (
        <p className="mt-1 text-xs text-ink/50">
          Add each thing as you finish it, and your report writes itself.
        </p>
      ) : (
        <ol className="mt-3 flex flex-col gap-1.5">
          {lines.map((line, index) => (
            <li
              key={`${index}-${line}`}
              dir="auto"
              className="rounded-xl bg-paper-soft/70 px-3 py-2 text-sm leading-relaxed text-ink"
            >
              {line}
            </li>
          ))}
        </ol>
      )}

      <form
        action={(formData) =>
          start(async () => {
            setError(null);
            try {
              const answer = await addToDailyReport(formData);
              if (!answer.ok) {
                setError(answer.error);
                return;
              }
              // Cleared by hand rather than by remounting the form: the box is
              // where their thumb already is, and the next line usually follows
              // the last one straight away.
              if (box.current) box.current.value = "";
              router.refresh();
            } catch (cause) {
              setError(shownError(cause, "That did not save."));
            }
          })
        }
        className="mt-3 flex items-center gap-2"
      >
        <input
          ref={box}
          name="line"
          // Written in Arabic as often as English, and it should read in its
          // own direction rather than the page's.
          dir="auto"
          required
          maxLength={500}
          placeholder="Finished the kitchen drawings…"
          className="h-11 min-w-0 flex-1 rounded-full border border-ink/12 bg-white/80 px-4 text-sm outline-none focus:border-cyan-strong"
        />
        <button
          type="submit"
          disabled={pending}
          aria-label="Add to today's report"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-bg disabled:opacity-60"
        >
          <Plus size={18} strokeWidth={2.25} />
        </button>
      </form>

      {error && <p className="mt-2 text-xs font-medium text-pink-strong">{error}</p>}
    </section>
  );
}
