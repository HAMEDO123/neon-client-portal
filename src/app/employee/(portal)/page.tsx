import Link from "next/link";
import { CalendarClock, CheckCircle2, Sun } from "lucide-react";
import { requireEmployee } from "@/lib/employee-session";
import { tasksForDay, type EmployeeTask } from "@/lib/employee-tasks";
import { getTimezone } from "@/lib/settings";
import { hourIn, todayKey, tomorrowKey } from "@/lib/time";
import { TaskCard } from "@/components/employee/task-card";
import { AssignedTaskCard } from "@/components/employee/assigned-task-card";
import { PushPrompt } from "@/components/employee/push-prompt";
import { planForTasks } from "@/lib/stage-deadlines";
import { myAssignedTasks, type AssignedTaskView } from "@/lib/assigned-tasks";
import { getPublicKey } from "@/lib/notifications/push";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

function greeting(hour: number) {
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

// One list per day, whatever kind of work is on it.
//
// A step on a project and a job the manager handed out are both things to do
// today, and splitting them into separate sections made the manager's jobs
// look like a different, lesser category. They share the day they belong to,
// highest priority first.
type DayItem = { kind: "board"; task: EmployeeTask } | { kind: "assigned"; task: AssignedTaskView };

const PRIORITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

function byPriority(a: DayItem, b: DayItem) {
  return PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority];
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

  const todayDay = todayKey(timezone);
  const tomorrowDay = tomorrowKey(timezone);

  // One after the other, like the other multi-query pages here: the local
  // Postgres proxy drops the connection when a page fires queries at once, and
  // the round trip saved is not worth a dashboard that fails to load.
  const today = await tasksForDay(employee.id, todayDay);
  const tomorrow = await tasksForDay(employee.id, tomorrowDay, "tomorrow");

  // One plan covering both lists: the stage periods turn into real dates the
  // same way for today's work and tomorrow's.
  const plan = await planForTasks([...today, ...tomorrow]);

  // Completed jobs are not fetched; everything else is sorted into a day below.
  const assigned = await myAssignedTasks(employee.id);
  const pushKey = await getPublicKey();

  // A job handed out by hand belongs to the first of today and tomorrow it
  // touches. One that started on or before today is today's — including one
  // whose days have run out, because unfinished work does not stop being
  // today's problem by being late.
  const todayItems: DayItem[] = [
    ...assigned.filter((task) => task.startKey <= todayDay).map((task) => ({ kind: "assigned" as const, task })),
    ...today.map((task) => ({ kind: "board" as const, task })),
  ].sort(byPriority);

  const tomorrowItems: DayItem[] = [
    ...assigned.filter((task) => task.startKey === tomorrowDay).map((task) => ({ kind: "assigned" as const, task })),
    ...tomorrow.map((task) => ({ kind: "board" as const, task })),
  ].sort(byPriority);

  const openToday = todayItems.filter((item) => item.task.state !== "DONE").length;
  const firstName = employee.name.split(" ")[0];

  const card = (item: DayItem) =>
    item.kind === "board" ? (
      <TaskCard key={item.task.id} task={item.task} timezone={timezone} dueBy={plan.get(item.task.id)?.dueBy} />
    ) : (
      <AssignedTaskCard key={item.task.id} task={item.task} timezone={timezone} />
    );

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

      <PushPrompt publicKey={pushKey} />

      <section id="today" className={cn(focus === "tomorrow" && "order-2")}>
        <SectionHeading icon={Sun} label="Today" count={todayItems.length} tone="text-ink" />
        {todayItems.length === 0 ? (
          <EmptyState
            className="mt-3 py-10"
            icon={CheckCircle2}
            title="No tasks for today"
            description="Anything scheduled for today will show up here."
          />
        ) : (
          <div className="mt-3 flex flex-col gap-3">{todayItems.map(card)}</div>
        )}
      </section>

      <section id="tomorrow" className={cn(focus === "tomorrow" && "order-1")}>
        <SectionHeading icon={CalendarClock} label="Tomorrow" count={tomorrowItems.length} tone="text-amber-700" />
        {tomorrowItems.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-ink/12 bg-ink/[0.02] px-4 py-6 text-center text-sm text-ink/45">
            Nothing scheduled for tomorrow yet.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">{tomorrowItems.map(card)}</div>
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
