import Link from "next/link";
import { CalendarClock, CheckCircle2, Sun } from "lucide-react";
import { requireEmployee } from "@/lib/employee-session";
import { tasksForDay, type EmployeeTask } from "@/lib/employee-tasks";
import { getTimezone } from "@/lib/settings";
import { hourIn, todayKey, tomorrowKey } from "@/lib/time";
import { TaskCard } from "@/components/employee/task-card";
import { AssignedTaskCard } from "@/components/employee/assigned-task-card";
import { PushPrompt } from "@/components/employee/push-prompt";
import { TodaySummary } from "@/components/employee/today-summary";
import { dayCounts } from "@/lib/daily-progress";
import { planForTasks } from "@/lib/stage-deadlines";
import { myAssignedTasks, type AssignedTaskView } from "@/lib/assigned-tasks";
import { getPublicKey } from "@/lib/notifications/push";
import { EmptyState } from "@/components/ui/empty-state";
import { WarningsCard } from "@/components/employee/warnings-card";
import { warningsFor } from "@/lib/employee-warnings";
import { SalesCard } from "@/components/employee/sales-card";
import { monthSalesFor } from "@/lib/sales-queries";
import { periodOf } from "@/lib/payroll";
import { cn } from "@/lib/utils";
import { myDay } from "@/lib/now-next-queries";
import { NowNextCard } from "@/components/employee/now-next-card";
import { ClockCard } from "@/components/employee/clock-card";
import { DayTimeline } from "@/components/employee/day-timeline";
import { FocusCard, latestTaskFor } from "@/components/employee/focus-card";
import { ReportLines } from "@/components/employee/report-lines";
import { myClockDay } from "@/lib/clock-day";
import { myAppClock } from "@/lib/app-clock-store";
import { linesOf, reportForDay } from "@/lib/daily-report";
import { conversationsFor } from "@/lib/chat";
import { ChatTile } from "@/components/employee/chat-tile";

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

// The latest task's width in the top row: whatever the clock and the ring
// leave of twelve columns. Written out so Tailwind sees each class.
const FOCUS_SPAN: Record<number, string> = {
  0: "lg:col-span-12",
  3: "lg:col-span-9",
  5: "lg:col-span-7",
  8: "lg:col-span-4",
};

function byPriority(a: DayItem, b: DayItem) {
  return PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority];
}

export default async function EmployeeDashboard({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
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

  // Finished jobs are fetched for today's scorecard, and kept out of the lists.
  const assignedAll = await myAssignedTasks(employee.id, { includeDone: true });
  const assigned = assignedAll.filter((task) => task.state !== "DONE");
  const pushKey = await getPublicKey();

  // Warnings stay pinned above everything until the manager removes them.
  const warnings = await warningsFor(employee.id);

  // This month against the sales target: a project counts for whoever sold it.
  const period = periodOf(todayDay);
  const sales = await monthSalesFor(employee.id, period);

  // Where they are in the day that was actually put on the board for them.
  // Read on its own, like everything else on this page.
  const { state: nowNext, hours } = await myDay(employee.id);

  // Their own day: when the device saw them in, and when they have to be gone
  // by. One after the other, like everything else on this page.
  const clockDay = await myClockDay(employee.id, todayDay, hours, timezone);
  // Clocking in from the app, for whoever the manager turned it on for.
  const appClock = await myAppClock(employee.id, todayDay, timezone);

  // What they have written down so far today, so the card shows it back.
  const report = await reportForDay(employee.id, todayDay);

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

  // Today's scorecard counts finished work too, which the lists leave out —
  // through the same rule as the manager's analytics, so the two agree.
  const todayCounts = dayCounts(today, assignedAll, todayDay);

  const openToday = todayItems.filter((item) => item.task.state !== "DONE").length;
  const firstName = employee.name.split(" ")[0];

  const card = (item: DayItem) =>
    item.kind === "board" ? (
      <TaskCard
        key={item.task.id}
        task={item.task}
        timezone={timezone}
        dueBy={plan.get(item.task.id)?.dueBy}
        startsAt={plan.get(item.task.id)?.startsAt}
      />
    ) : (
      <AssignedTaskCard key={item.task.id} task={item.task} timezone={timezone} />
    );

  // The newest job handed to them (components/employee/focus-card.tsx).
  const latestTask = await latestTaskFor(employee.id);
  // A published plan still shows its own card; without one it would only say
  // "nothing planned", and the timeline says the day better.
  const hasPlan = nowNext.now !== null || nowNext.next !== null;

  // The newest conversations, for the chat tile. On its own, like the rest.
  const conversations = await conversationsFor({
    type: "EMPLOYEE",
    id: employee.id,
    name: employee.name,
  });

  // Design 2 (chosen 2026-11-19): the day as tiles. Across the top the clock,
  // the latest task in the accent colour and today's progress as a ring; under
  // them the day's work in the wide column and the report, the chat and the
  // rest beside it. On a phone the tiles stack, the side column first.
  return (
    <div className="wide-page flex flex-col gap-4 lg:gap-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">
          {greeting(hourIn(timezone))}, {firstName}
        </h1>
        <p className="mt-1 text-sm text-ink/55">
          {openToday === 0
            ? "Nothing outstanding for today."
            : `${openToday} task${openToday === 1 ? "" : "s"} still open today.`}
        </p>
      </div>

      <WarningsCard warnings={warnings} timezone={timezone} />

      <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
        {/* The clock card draws nothing on a day the studio is closed; the
            latest task then takes its room. */}
        {clockDay.working && (
          <div className="lg:col-span-5 [&>*]:h-full">
            <ClockCard day={clockDay} timezone={timezone} app={appClock} />
          </div>
        )}
        <div className={FOCUS_SPAN[(clockDay.working ? 5 : 0) + (todayCounts.total > 0 ? 3 : 0)]}>
          <FocusCard task={latestTask} todayKey={todayDay} timezone={timezone} openCount={openToday} />
        </div>
        {todayCounts.total > 0 && (
          <div className="lg:col-span-3">
            <TodaySummary counts={todayCounts} look="ring" />
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-12 lg:items-start lg:gap-5">
        <div className="flex flex-col gap-4 lg:order-2 lg:col-span-5 lg:gap-5">
          {hasPlan && <NowNextCard state={nowNext} hours={hours} />}

          {/* Written where the work is, a line at a time. */}
          <ReportLines lines={linesOf(report.text)} />

          <ChatTile conversations={conversations} timeZone={timezone} now={new Date()} />

          <SalesCard projects={sales.projects} target={sales.target} period={period} timezone={timezone} />

          <PushPrompt publicKey={pushKey} />
        </div>

        <div className="flex flex-col gap-4 lg:order-1 lg:col-span-7 lg:gap-5">
          <DayTimeline
            employeeId={employee.id}
            dayKey={todayDay}
            timezone={timezone}
            arrivedAt={clockDay.arrivedAt}
            endsAt={clockDay.endsAt}
            reportLines={linesOf(report.text)}
          />

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
              <p className="mt-3 rounded-2xl border border-dashed border-ink/12 bg-ink/[0.02] px-4 py-6 text-center text-sm text-ink/55">
                Nothing scheduled for tomorrow yet.
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-3">{tomorrowItems.map(card)}</div>
            )}
          </section>

          <Link
            href="/employee/tasks"
            className="lq-pill order-3 rounded-full px-4 py-3 text-center text-sm font-semibold text-ink/75 transition-colors hover:text-ink"
          >
            View all my tasks
          </Link>
        </div>
      </div>
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
