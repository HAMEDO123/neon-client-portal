import Link from "next/link";
import { CalendarClock, CheckCircle2, Sun } from "lucide-react";
import { requireEmployee } from "@/lib/employee-session";
import { tasksForDay } from "@/lib/employee-tasks";
import { getTimezone } from "@/lib/settings";
import { hourIn, todayKey, tomorrowKey } from "@/lib/time";
import { TaskCard } from "@/components/employee/task-card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

function greeting(hour: number) {
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

export default async function EmployeeDashboard({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const employee = await requireEmployee();
  const timezone = await getTimezone();
  const { day } = await searchParams;

  // Push notifications for tomorrow's schedule land here with ?day=tomorrow.
  const focus = day === "tomorrow" ? "tomorrow" : "today";

  const [today, tomorrow] = await Promise.all([
    tasksForDay(employee.id, todayKey(timezone)),
    tasksForDay(employee.id, tomorrowKey(timezone), "tomorrow"),
  ]);

  const openToday = today.filter((t) => t.state !== "DONE").length;
  const firstName = employee.name.split(" ")[0];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">
          {greeting(hourIn(timezone))}, {firstName} 👋
        </h1>
        <p className="mt-1 text-sm text-ink/50">
          {openToday === 0
            ? "Nothing outstanding for today."
            : `${openToday} task${openToday === 1 ? "" : "s"} still open today.`}
        </p>
      </div>

      <section id="today" className={cn(focus === "tomorrow" && "order-2")}>
        <SectionHeading icon={Sun} label="Today" count={today.length} tone="text-ink" />
        {today.length === 0 ? (
          <EmptyState
            className="mt-3 py-10"
            icon={CheckCircle2}
            title="No tasks for today"
            description="Anything scheduled for today will show up here."
          />
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {today.map((task) => (
              <TaskCard key={task.id} task={task} timezone={timezone} />
            ))}
          </div>
        )}
      </section>

      <section id="tomorrow" className={cn(focus === "tomorrow" && "order-1")}>
        <SectionHeading icon={CalendarClock} label="Tomorrow" count={tomorrow.length} tone="text-amber-700" />
        {tomorrow.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-ink/12 bg-ink/[0.02] px-4 py-6 text-center text-sm text-ink/45">
            Nothing scheduled for tomorrow yet.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {tomorrow.map((task) => (
              <TaskCard key={task.id} task={task} timezone={timezone} />
            ))}
          </div>
        )}
      </section>

      <Link
        href="/employee/tasks"
        className="order-3 rounded-2xl border border-ink/10 bg-white/60 px-4 py-3 text-center text-sm font-medium text-ink/70 transition-colors hover:bg-white"
      >
        View all my tasks
      </Link>
    </div>
  );
}

function SectionHeading({
  icon: Icon,
  label,
  count,
  tone,
}: {
  icon: typeof Sun;
  label: string;
  count: number;
  tone: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className={cn("inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wider", tone)}>
        <Icon size={15} strokeWidth={2} />
        {label}
      </h2>
      <span className="text-xs font-medium text-ink/45">
        {count} {count === 1 ? "task" : "tasks"}
      </span>
    </div>
  );
}
