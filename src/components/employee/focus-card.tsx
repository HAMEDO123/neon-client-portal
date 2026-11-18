import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { prisma } from "@/lib/db";
import { dateToDayKey, dayKeyIn, formatTimeIn, shiftDayKey } from "@/lib/time";

// The newest job handed to somebody, in the darkest card on their home screen.
//
// It began (2026-11-18) as "what to do now" — something in progress, else the
// most urgent of today's — and on the first day the studio asked instead for
// "اخر تاسك نزل": the last task that came down. What arrived most recently is
// what somebody has not read yet; the rest is on their list already.
//
// Anything not yet approved counts: a job already sent for review is still
// the newest thing they were given, and says so.

export type LatestTask = {
  id: string;
  title: string;
  state: string;
  priority: string;
  endKey: string;
  createdAt: Date;
  from: string;
};

export async function latestTaskFor(employeeId: string): Promise<LatestTask | null> {
  const row = await prisma.assignedTask.findFirst({
    where: { employeeId, state: { not: "DONE" } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      state: true,
      priority: true,
      endDay: true,
      createdAt: true,
      routineId: true,
      assignedBy: { select: { name: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    state: row.state,
    priority: row.priority,
    endKey: dateToDayKey(row.endDay) ?? "",
    createdAt: row.createdAt,
    from: row.routineId ? "Every day" : (row.assignedBy?.name ?? "The manager"),
  };
}

export function FocusCard({
  task,
  todayKey,
  timezone,
  openCount,
}: {
  task: LatestTask | null;
  todayKey: string;
  timezone: string;
  openCount: number;
}) {
  if (!task) {
    return (
      <section aria-label="Latest task" className="rounded-2xl bg-bark p-5 text-paper">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c9a77f]">Latest task</p>
        <p className="mt-2 text-sm text-paper/80">Nothing open on your list.</p>
      </section>
    );
  }

  const createdKey = dayKeyIn(timezone, task.createdAt);
  const when =
    createdKey === todayKey
      ? `Today ${formatTimeIn(timezone, task.createdAt) ?? ""}`
      : createdKey === shiftDayKey(todayKey, -1)
        ? `Yesterday ${formatTimeIn(timezone, task.createdAt) ?? ""}`
        : new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "numeric", month: "short" }).format(
            task.createdAt
          );

  const due =
    task.state === "SUBMITTED"
      ? "Sent for review"
      : task.endKey < todayKey
        ? "Late"
        : task.endKey === todayKey
          ? "Due today"
          : "Due later";

  const action =
    task.state === "IN_PROGRESS"
      ? "Open — send proof when done"
      : task.state === "SUBMITTED"
        ? "Open"
        : "Open and start";

  return (
    <section aria-label="Latest task" className="rounded-2xl bg-bark p-5 text-paper">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c9a77f]">Latest task</p>
      {/* A heading of the card, not of the page. */}
      <p dir="auto" className="mt-2 font-display text-2xl leading-snug">
        {task.title}
      </p>
      <p className="mt-1 text-xs text-paper/65">
        {when.trim()} · from {task.from}
      </p>
      <p className="mt-0.5 text-xs text-paper/65">
        {due}
        {task.priority === "HIGH" ? " · high priority" : ""}
        {openCount > 1 ? ` · ${openCount - 1} other open` : ""}
      </p>
      <Link
        href={`/employee/assigned/${task.id}`}
        className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-[#c9a77f] px-4 text-sm font-semibold text-bark transition-opacity hover:opacity-90"
      >
        {action}
        <ArrowRight size={15} strokeWidth={2.25} />
      </Link>
    </section>
  );
}
