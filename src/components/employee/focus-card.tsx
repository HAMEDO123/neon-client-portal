import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { AssignedTaskView } from "@/lib/assigned-tasks";

// What to do now (the new UI, "my day as a timeline", 2026-11-18): the job
// somebody is on, or else the first one they should pick up — the one question
// the home screen is opened to answer, in the darkest card on it.
//
// Chosen from their own list, never guessed from a plan: something already in
// progress first (highest priority among those), then today's work not yet
// started, highest priority first.

const RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

export function pickFocus(tasks: AssignedTaskView[], todayKey: string): AssignedTaskView | null {
  const open = tasks.filter(
    (task) => task.startKey <= todayKey && (task.state === "IN_PROGRESS" || task.state === "TODO")
  );
  const order = (a: AssignedTaskView, b: AssignedTaskView) =>
    RANK[a.priority] - RANK[b.priority] || a.endKey.localeCompare(b.endKey);
  const going = open.filter((task) => task.state === "IN_PROGRESS").sort(order);
  if (going.length > 0) return going[0];
  return open.filter((task) => task.state === "TODO").sort(order)[0] ?? null;
}

export function FocusCard({
  task,
  todayKey,
  openCount,
}: {
  task: AssignedTaskView | null;
  todayKey: string;
  openCount: number;
}) {
  if (!task) {
    return (
      <section aria-label="Now" className="rounded-2xl bg-bark p-5 text-paper">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c9a77f]">Now</p>
        <p className="mt-2 text-sm text-paper/80">
          {openCount === 0
            ? "Nothing left on your list for today."
            : "Nothing started yet — pick one from today's list."}
        </p>
      </section>
    );
  }

  const going = task.state === "IN_PROGRESS";
  const due = task.endKey < todayKey ? "Late" : task.endKey === todayKey ? "Due today" : "Due later";

  return (
    <section aria-label="Now" className="rounded-2xl bg-bark p-5 text-paper">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c9a77f]">
        {going ? "Now" : "Start with"}
      </p>
      {/* A heading of the card, not of the page. */}
      <p dir="auto" className="mt-2 font-display text-2xl leading-snug">
        {task.title}
      </p>
      <p className="mt-1 text-xs text-paper/65">
        {due}
        {task.priority === "HIGH" ? " · high priority" : ""}
        {openCount > 1 ? ` · ${openCount - 1} more today` : ""}
      </p>
      <Link
        href={`/employee/assigned/${task.id}`}
        className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-[#c9a77f] px-4 text-sm font-semibold text-bark transition-opacity hover:opacity-90"
      >
        {going ? "Open — send proof when done" : "Open and start"}
        <ArrowRight size={15} strokeWidth={2.25} />
      </Link>
    </section>
  );
}
