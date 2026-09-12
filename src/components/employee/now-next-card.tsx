import Link from "next/link";
import { ArrowRight, Coffee, Clock } from "lucide-react";
import { describeMinutes, headline, type NowNext } from "@/lib/now-next";
import type { WorkHours } from "@/lib/work-hours";

// The first thing an employee sees: what they are on, and what follows.
//
// It answers three questions and no more — what now, what is the output, what
// next — because a screen that answers those does not need the person to read a
// list and work it out. Everything else on the page stays where it was.
//
// It never implies idleness. A day with nothing on it says exactly that, and
// outside working hours it says the hours rather than showing an empty box.

function linkFor(slot: { entryId: string | null; jobId: string | null } | null): string | null {
  if (!slot) return null;
  if (slot.entryId) return `/employee/tasks/${slot.entryId}`;
  if (slot.jobId) return `/employee/assigned/${slot.jobId}`;
  return null;
}

export function NowNextCard({ state, hours }: { state: NowNext; hours: WorkHours }) {
  const nowLink = linkFor(state.now);
  const nextLink = linkFor(state.next);
  const lead = headline(state, hours);

  return (
    <section className="glass rounded-2xl p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink/40">Right now</p>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 dir="auto" className="text-lg font-semibold leading-tight text-ink">
          {lead}
        </h2>
        {state.leftOfBlock != null && (
          <span className="text-xs font-medium text-ink/50">{describeMinutes(state.leftOfBlock)} left</span>
        )}
      </div>

      {nowLink && (
        <Link
          href={nowLink}
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-ink px-4 text-sm font-medium text-bg"
        >
          Open it
          <ArrowRight size={15} strokeWidth={2} />
        </Link>
      )}

      {state.onBreak && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-ink/50">
          <Coffee size={13} strokeWidth={2} />
          Break time
        </p>
      )}

      {state.next && (
        <div className="mt-3 border-t border-ink/8 pt-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ink/40">Next</p>
          <p dir="auto" className="mt-0.5 text-sm text-ink/75">
            {state.next.from} · {state.next.what}
          </p>
          {nextLink && (
            <Link href={nextLink} className="mt-1 inline-block text-xs font-medium text-cyan-strong">
              Have a look
            </Link>
          )}
        </div>
      )}

      {!state.beforeWork && !state.afterWork && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-ink/35">
          <Clock size={12} strokeWidth={2} />
          {describeMinutes(state.leftOfDay)} of the working day left
        </p>
      )}
    </section>
  );
}
