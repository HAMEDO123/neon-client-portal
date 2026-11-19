import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { prisma } from "@/lib/db";
import { dateToDayKey, dayKeyIn, formatTimeIn, shiftDayKey } from "@/lib/time";

// The newest job handed to somebody, in the one tile on their home screen
// painted in the colourway's accent (design 2, 2026-11-19; it was the dark
// bark card before).
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
      <section aria-label="Latest task" className="lq-accent flex h-full flex-col rounded-2xl p-5 text-white">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/85">Latest task</p>
        <p className="mt-2 text-sm text-white/90">Nothing open on your list.</p>
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
    <section aria-label="Latest task" className="lq-accent flex h-full flex-col rounded-2xl p-5 text-white">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/85">Latest task</p>
      {/* A heading of the card, not of the page. */}
      <p dir="auto" className="mt-2 font-display text-2xl leading-snug lg:text-[1.7rem]">
        {task.title}
      </p>
      <p className="mt-2 text-xs text-white/85">
        {when.trim()} · from {task.from}
      </p>
      <p className="mt-0.5 text-xs text-white/85">
        {due}
        {task.priority === "HIGH" ? " · high priority" : ""}
        {openCount > 1 ? ` · ${openCount - 1} other open` : ""}
      </p>
      <span aria-hidden className="block min-h-4 flex-1" />
      <Link
        href={`/employee/assigned/${task.id}`}
        className="mt-auto inline-flex h-11 items-center gap-2 self-start rounded-full bg-white px-5 text-sm font-semibold text-clay-deep transition-opacity hover:opacity-90"
      >
        {action}
        <ArrowRight size={15} strokeWidth={2.25} />
      </Link>
    </section>
  );
}
