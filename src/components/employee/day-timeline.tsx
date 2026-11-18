import Link from "next/link";
import { prisma } from "@/lib/db";
import { clockLabel } from "@/lib/attendance";
import { buildTimeline, minutesOfClock, type TimelineItem, type TimelineKind } from "@/lib/day-timeline";
import { instantAt, shiftDayKey, wallClockIn } from "@/lib/time";
import { cn } from "@/lib/utils";

// The day as it went, in time order (lib/day-timeline.ts) — the main column of
// the team's home screen on a desk, and below the clock card on a phone.

const KIND_LABEL: Record<TimelineKind, string> = {
  "clock-in": "Clock-in",
  report: "Report",
  started: "Started",
  sent: "Sent for review",
  approved: "Approved",
  "sent-back": "Sent back",
  now: "Now",
  ends: "Clock out by",
};

const DOT: Record<TimelineKind, string> = {
  "clock-in": "border-2 border-ink bg-white",
  report: "bg-clay",
  started: "bg-clay-deep",
  sent: "bg-emerald-600",
  approved: "bg-emerald-700",
  "sent-back": "bg-amber-600",
  now: "bg-clay",
  ends: "border-2 border-dashed border-ink/40 bg-white",
};

export async function DayTimeline({
  employeeId,
  dayKey,
  timezone,
  arrivedAt,
  endsAt,
  reportLines,
}: {
  employeeId: string;
  dayKey: string;
  timezone: string;
  arrivedAt: Date | null;
  endsAt: Date | null;
  reportLines: string[];
}) {
  const from = instantAt(dayKey, "00:00", timezone);
  const to = instantAt(shiftDayKey(dayKey, 1), "00:00", timezone);

  // Every move this person's work made today: their own jobs, and the project
  // steps they hold by name.
  const changes =
    from && to
      ? await prisma.taskStateChange.findMany({
          where: {
            createdAt: { gte: from, lt: to },
            OR: [{ job: { employeeId } }, { entry: { assigneeId: employeeId } }],
          },
          orderBy: { createdAt: "asc" },
          take: 60,
          select: {
            createdAt: true,
            fromState: true,
            toState: true,
            job: { select: { id: true, title: true } },
            entry: { select: { id: true, task: { select: { name: true } } } },
          },
        })
      : [];

  const minutesAt = (at: Date | null) => (at ? minutesOfClock(wallClockIn(timezone, at)) : null);
  const items = buildTimeline({
    arrivedMinutes: minutesAt(arrivedAt),
    endsAtMinutes: minutesAt(endsAt),
    nowMinutes: minutesOfClock(wallClockIn(timezone)) ?? 0,
    reportLines,
    changes: changes.map((change) => ({
      minutes: minutesAt(change.createdAt) ?? 0,
      fromState: change.fromState,
      toState: change.toState,
      title: change.job?.title ?? change.entry?.task.name ?? "A task",
      href: change.job
        ? `/employee/assigned/${change.job.id}`
        : change.entry
          ? `/employee/tasks/${change.entry.id}`
          : undefined,
    })),
  });

  return (
    <section aria-label="Your day so far" className="glass rounded-2xl p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg text-ink">Your day</h2>
        <span className="text-xs text-ink/45">What happened, in order</span>
      </div>

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-ink/55">
          Nothing yet today. Clocking in, each line of your report and every task you start or send will show here as it
          happens.
        </p>
      ) : (
        <ol className="relative mt-4 flex flex-col">
          {/* The line the dots sit on. */}
          <span aria-hidden className="absolute bottom-3 left-[4.56rem] top-3 w-px bg-ink/10" />
          {items.map((item, index) => (
            <Row key={`${item.kind}-${item.minutes}-${index}`} item={item} />
          ))}
        </ol>
      )}
    </section>
  );
}

function Row({ item }: { item: TimelineItem }) {
  if (item.kind === "now") {
    return (
      <li className="relative flex items-center gap-3 py-2">
        <span className="w-14 shrink-0 text-right text-xs font-semibold tabular-nums text-clay-deep">
          {clockLabel(item.minutes)}
        </span>
        <span className="relative z-10 h-3 w-3 shrink-0 rounded-full bg-clay ring-4 ring-clay/15" />
        <span className="h-px flex-1 bg-clay/50" />
        <span className="text-xs font-semibold uppercase tracking-wider text-clay-deep">Now</span>
      </li>
    );
  }

  const body = (
    <>
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink/40">
        {KIND_LABEL[item.kind]}
      </span>
      <span dir="auto" className="block text-sm font-medium text-ink">
        {item.kind === "clock-in" || item.kind === "ends" ? clockLabel(item.minutes) : item.title}
      </span>
    </>
  );

  return (
    <li className={cn("relative flex items-start gap-3 py-2", item.future && "opacity-60")}>
      <span className="w-14 shrink-0 pt-1 text-right text-xs tabular-nums text-ink/50">{clockLabel(item.minutes)}</span>
      <span className={cn("relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", DOT[item.kind])} />
      {item.href ? (
        <Link href={item.href} className="min-w-0 flex-1 rounded-lg hover:bg-ink/[0.03]">
          {body}
        </Link>
      ) : (
        <span className="min-w-0 flex-1">{body}</span>
      )}
    </li>
  );
}
