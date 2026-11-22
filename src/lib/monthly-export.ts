import { prisma } from "@/lib/db";
import { proofUrls } from "@/lib/attachments";
import { csvFile, csvRow } from "@/lib/csv";
import { dateToDayKey, dayKeyIn, dayKeyToDate, formatTimeIn, instantAt } from "@/lib/time";
import { nextPeriod, periodDayKeys, periodFirstDayKey, periodOf } from "@/lib/pay-period";
import { isWorkingDay, type WorkHours } from "@/lib/work-hours";
import { getWorkHours } from "@/lib/settings";

// The month on paper, for the manager: what each person wrote about each day,
// and what each was given to do and whether they did it. Two files, asked for
// apart (2026-11-16), and then asked for whole (2026-11-17): "show me what is
// the content of the report and the task done and if they did not do it, same
// for the report". So both list what was *expected*, not only what arrived —
// every working day, every task due — and say plainly where nothing came.
//
// The studio's month: the 5th to the 4th, the same period as payroll
// (lib/pay-period.ts) — "November" is 5 November to 4 December. The first cut
// used the calendar month; the owner corrected it the same day: "the same
// period from 5th to 4th is each month". Read from pay-period rather than
// written again here, so the files and the pay sheet cannot disagree about
// where a month begins.
//
// The builders are pure and take plain rows, so what goes in a column is
// pinned by tests; the loaders below them are the only part that reads the
// database.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * `2026-11` from the query string, or the period today is in when it is
 * missing or wrong — on the 3rd, that is last month's, still running.
 */
export function readMonth(raw: string | null | undefined, todayKey: string): string {
  return raw && MONTH.test(raw) ? raw : periodOf(todayKey);
}

/** The period's first day, and the first day of the one after it, as day keys. */
export function monthBounds(month: string): { first: string; next: string } {
  return { first: periodFirstDayKey(month), next: periodFirstDayKey(nextPeriod(month)) };
}

/** "Sun" for a day key — read at noon UTC so no machine's clock moves the day. */
export function weekdayOf(dayKey: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(
    new Date(`${dayKey}T12:00:00Z`)
  );
}

// ---------------------------------------------------------------------------
// Reports: every working day, written or not

export type ReportPerson = {
  id: string;
  name: string;
  role: string | null;
  /** Still on the team. Somebody who has left is listed only for the days they wrote. */
  active: boolean;
  /** The first day they were on the platform; nothing is expected of them before it. */
  sinceKey: string;
};

export type WrittenReport = { employeeId: string; dayKey: string; text: string; lastEdited: string };

/** What the fingerprint device says about a day: "In 9:02 AM", "Recorded", or nothing at all. */
export type AttendanceMark = { employeeId: string; dayKey: string; mark: string };

export type ReportDayStatus = "Written" | "Not written" | "Not written yet";

export type ReportDay = {
  person: string;
  role: string | null;
  dayKey: string;
  status: ReportDayStatus;
  text: string;
  lastEdited: string;
  attendance: string;
};

/**
 * Each person's period, day by day: the report where there is one, and "Not
 * written" on a working day where there is not.
 *
 * A day the studio is shut (the work hours' weekdays) is listed only if
 * somebody wrote on it anyway. Today is "Not written yet" — the day is not
 * over, and calling it missed at noon would be wrong. Days after today are not
 * listed: nothing is owed for them yet.
 *
 * The attendance column is there so "Not written" can be read for what it is:
 * a day nobody clocked in is an absence, and a missing report on it is not the
 * same failing as one on a day they were in.
 */
export function reportDays(input: {
  people: ReportPerson[];
  reports: WrittenReport[];
  attendance: AttendanceMark[];
  days: string[];
  hours: WorkHours;
  todayKey: string;
}): ReportDay[] {
  const key = (employeeId: string, dayKey: string) => `${employeeId}|${dayKey}`;
  const written = new Map(input.reports.map((report) => [key(report.employeeId, report.dayKey), report]));
  const marks = new Map(input.attendance.map((mark) => [key(mark.employeeId, mark.dayKey), mark.mark]));

  const rows: ReportDay[] = [];
  for (const person of input.people) {
    for (const dayKey of input.days) {
      if (dayKey > input.todayKey) break;
      const report = written.get(key(person.id, dayKey));
      const attendance = marks.get(key(person.id, dayKey)) ?? "No attendance";

      if (report) {
        rows.push({
          person: person.name,
          role: person.role,
          dayKey,
          status: "Written",
          text: report.text.trim(),
          lastEdited: report.lastEdited,
          attendance,
        });
        continue;
      }

      if (!person.active || dayKey < person.sinceKey || !isWorkingDay(input.hours, dayKey)) continue;
      rows.push({
        person: person.name,
        role: person.role,
        dayKey,
        status: dayKey === input.todayKey ? "Not written yet" : "Not written",
        text: "",
        lastEdited: "",
        attendance,
      });
    }
  }
  return rows;
}

const REPORT_COLUMNS = ["Employee", "Role", "Date", "Day", "Status", "Report", "Last edited", "Attendance"];

/**
 * The report stays one cell — its lines are kept, and Excel shows them as
 * lines inside it — because it is read as a paragraph, not a table. Under the
 * days, each person's count: working days so far, written, not written.
 */
export function reportsCsv(rows: ReportDay[]): string {
  const lines = [csvRow(REPORT_COLUMNS)];
  for (const row of rows) {
    lines.push(
      csvRow([
        row.person,
        row.role ?? "",
        row.dayKey,
        weekdayOf(row.dayKey),
        row.status,
        row.text,
        row.lastEdited,
        row.attendance,
      ])
    );
  }

  lines.push("", csvRow(["Employee", "Days written", "Days not written"]));
  for (const [person, days] of groupBy(rows, (row) => row.person)) {
    lines.push(
      csvRow([
        person,
        days.filter((day) => day.status === "Written").length,
        days.filter((day) => day.status === "Not written").length,
      ])
    );
  }
  return csvFile(lines);
}

// ---------------------------------------------------------------------------
// Tasks: everything due, done or not

export type TaskState = "TODO" | "IN_PROGRESS" | "SUBMITTED" | "DONE" | "TOMORROW";

export type TaskRow = {
  person: string;
  title: string;
  kind: "Job" | "Routine" | "Site visit" | "Chat task" | "Project step";
  project: string | null;
  startKey: string | null;
  /** The last day it was due, where one was set. */
  dueKey: string | null;
  state: TaskState;
  /** The studio day proof was first sent for review. */
  sentKey: string | null;
  /** The studio day the manager approved it, when it is approved. */
  doneKey: string | null;
  /** What the manager wrote when handing it out. */
  asked: string;
  deliverable: string;
  acceptance: string;
  /** What the employee wrote when sending it in, every time they did. */
  employeeNote: string;
  /** Links to what they sent — a photo, a screenshot, a file — one per line. */
  proof: string;
  /** What the manager wrote back on the last review, if anything. */
  managerNote: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  /** "Manager", an assigner's name, "Project board", or "" when nobody recorded it. */
  assignedBy: string;
};

export type TaskStatus = "Done" | "Sent — waiting for review" | "Not done" | "Due today" | "Not due yet";

/**
 * Where a task stands, in words. "Done" is approved by the manager; sent and
 * waiting is the manager's move, not a failing of the person, so it is said
 * apart. A task nobody sent anything for is "Not done" once its day has gone.
 */
export function taskStatus(row: Pick<TaskRow, "state" | "dueKey">, todayKey: string): TaskStatus {
  if (row.state === "DONE") return "Done";
  if (row.state === "SUBMITTED") return "Sent — waiting for review";
  if (row.dueKey == null || row.dueKey < todayKey) return "Not done";
  return row.dueKey === todayKey ? "Due today" : "Not due yet";
}

/**
 * Late: handed in after its due day, or not handed in and its day has gone.
 * Whole days, the due day itself is not late, as on the cards.
 *
 * Handed in, not approved: the manager approves in batches, often days later,
 * and judged by approval nearly everything in November came out late (109 of
 * 118 on 2026-11-16). The 9 PM cutoff draws the same line — work sent for
 * review by then is in. Work the manager ticked off with nothing sent is
 * judged by the day it was approved, the one date there is.
 */
export function isLateTask(row: Pick<TaskRow, "state" | "dueKey" | "sentKey" | "doneKey">, todayKey: string): boolean {
  if (row.dueKey == null) return false;
  const handedIn = row.sentKey ?? (row.state === "DONE" ? row.doneKey : null);
  return (handedIn ?? todayKey) > row.dueKey;
}

const TASK_COLUMNS = [
  "Employee",
  "Task",
  "Type",
  "Project",
  "From",
  "Due",
  "Status",
  "Late",
  "Sent for review",
  "Approved on",
  "What was asked",
  "What to hand in",
  "Counts as done when",
  "Employee's note",
  "Proof",
  "Manager's note",
  "Priority",
  "Assigned by",
];

const PRIORITY = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" } as const;

/**
 * One row per task: each person's period, in the order things were due, with
 * what was asked, what came back, and where it stands. Under them, each
 * person's count of each.
 */
export function tasksCsv(rows: TaskRow[], todayKey: string): string {
  const lines = [csvRow(TASK_COLUMNS)];
  for (const row of rows) {
    lines.push(
      csvRow([
        row.person,
        row.title,
        row.kind,
        row.project ?? "",
        row.startKey ?? "",
        row.dueKey ?? "",
        taskStatus(row, todayKey),
        isLateTask(row, todayKey) ? "Late" : "",
        row.sentKey ?? "",
        row.doneKey ?? "",
        row.asked,
        row.deliverable,
        row.acceptance,
        row.employeeNote,
        row.proof,
        row.managerNote,
        PRIORITY[row.priority],
        row.assignedBy,
      ])
    );
  }

  lines.push("", csvRow(["Employee", "Tasks", "Done", "Waiting for review", "Not done", "Late"]));
  for (const [person, tasks] of groupBy(rows, (row) => row.person)) {
    const status = tasks.map((task) => taskStatus(task, todayKey));
    lines.push(
      csvRow([
        person,
        tasks.length,
        status.filter((s) => s === "Done").length,
        status.filter((s) => s === "Sent — waiting for review").length,
        status.filter((s) => s === "Not done").length,
        tasks.filter((task) => isLateTask(task, todayKey)).length,
      ])
    );
  }
  return csvFile(lines);
}

/** Groups in the order each key first appears, which is the team's order. */
function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return groups;
}

// ---------------------------------------------------------------------------
// Reading the period

export async function loadMonthReports(month: string, timezone: string, todayKey: string): Promise<ReportDay[]> {
  const { first, next } = monthBounds(month);
  const range = { gte: dayKeyToDate(first), lt: dayKeyToDate(next) };

  const [team, reports, records, hours] = await Promise.all([
    prisma.employee.findMany({
      // The team, and anybody who has left but wrote something this period.
      where: {
        accessRole: "EMPLOYEE",
        OR: [{ active: true }, { dailyReports: { some: { day: range, text: { not: "" } } } }],
      },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true, role: true, active: true, createdAt: true },
    }),
    prisma.dailyReport.findMany({
      where: { day: range, text: { not: "" } },
      select: { employeeId: true, day: true, text: true, updatedAt: true },
    }),
    prisma.attendanceRecord.findMany({
      where: { day: range },
      select: { employeeId: true, day: true, arrivedAt: true },
    }),
    getWorkHours(),
  ]);

  return reportDays({
    people: team.map((person) => ({
      id: person.id,
      name: person.name,
      role: person.role,
      active: person.active,
      sinceKey: dayKeyIn(timezone, person.createdAt),
    })),
    reports: reports.map((report) => ({
      employeeId: report.employeeId,
      dayKey: dateToDayKey(report.day)!,
      text: report.text,
      lastEdited: formatTimeIn(timezone, report.updatedAt) ?? "",
    })),
    attendance: records.map((record) => ({
      employeeId: record.employeeId,
      dayKey: dateToDayKey(record.day)!,
      mark: record.arrivedAt ? `In ${formatTimeIn(timezone, record.arrivedAt)}` : "Recorded",
    })),
    days: periodDayKeys(month),
    hours,
    todayKey,
  });
}

/**
 * When `assignedById` started being written (2026-11-14, 14:16 studio time).
 * A job with none after it was the manager's; before it, nobody knows, and the
 * file says nothing rather than guess.
 */
const ASSIGNER_RECORDED_FROM = new Date("2026-11-14T11:16:25Z");

/** Every proof sent, oldest first: the first is when it was handed in, the rest is what came with it. */
const sent = {
  orderBy: { createdAt: "asc" as const },
  select: { createdAt: true, note: true, imageUrl: true, extraUrls: true, reviewNote: true },
};

type Sent = { createdAt: Date; note: string | null; imageUrl: string; extraUrls: string[]; reviewNote: string | null };

const joined = (values: (string | null)[]) =>
  values
    .map((value) => value?.trim())
    .filter(Boolean)
    .join("\n");

/**
 * The period's tasks: everything due in it, and anything approved in it that
 * was due before — work finished this month is this month's, wherever its date
 * fell. A project step is in when a deadline set on it falls in the period or
 * it was approved in it; one with neither has no day to be judged by, and the
 * stage plan's countdown is not worked out a second time here.
 */
export async function loadMonthTasks(month: string, timezone: string): Promise<TaskRow[]> {
  const { first, next } = monthBounds(month);
  // Due days are calendar days; approval and a step's deadline are instants.
  const from = instantAt(first, "00:00", timezone) ?? dayKeyToDate(first);
  const until = instantAt(next, "00:00", timezone) ?? dayKeyToDate(next);
  const approvedInPeriod = { state: "DONE" as const, completedAt: { gte: from, lt: until } };

  const [jobs, steps] = await Promise.all([
    prisma.assignedTask.findMany({
      where: { OR: [{ endDay: { gte: dayKeyToDate(first), lt: dayKeyToDate(next) } }, approvedInPeriod] },
      select: {
        title: true,
        note: true,
        deliverable: true,
        acceptance: true,
        lastUpdateNote: true,
        startDay: true,
        endDay: true,
        state: true,
        completedAt: true,
        priority: true,
        createdAt: true,
        routineId: true,
        siteVisitId: true,
        chatTaskId: true,
        assignedById: true,
        assignedBy: { select: { name: true } },
        submissions: sent,
        employee: { select: { name: true, order: true } },
      },
    }),
    prisma.projectTaskEntry.findMany({
      where: { assigneeId: { not: null }, OR: [{ dueAt: { gte: from, lt: until } }, approvedInPeriod] },
      select: {
        adminNote: true,
        employeeNote: true,
        deliverable: true,
        acceptance: true,
        state: true,
        completedAt: true,
        dueAt: true,
        scheduledFor: true,
        priority: true,
        task: { select: { name: true } },
        submissions: sent,
        project: { select: { name: true } },
        assignee: { select: { name: true, order: true } },
      },
    }),
  ]);

  const handedIn = (submissions: Sent[]) => ({
    sentKey: submissions[0] ? dayKeyIn(timezone, submissions[0].createdAt) : null,
    proof: joined(submissions.flatMap((submission) => proofUrls(submission))),
    managerNote:
      [...submissions]
        .reverse()
        .find((submission) => submission.reviewNote?.trim())
        ?.reviewNote?.trim() ?? "",
  });
  const doneKeyOf = (state: string, completedAt: Date | null) =>
    state === "DONE" && completedAt ? dayKeyIn(timezone, completedAt) : null;

  // Each row with what it is sorted by beside it, not in it.
  const entries: { order: number; due: string; row: TaskRow }[] = [
    ...jobs.map((job) => {
      const dueKey = dateToDayKey(job.endDay);
      return {
        order: job.employee.order,
        due: dueKey ?? "",
        row: {
          person: job.employee.name,
          title: job.title,
          kind: job.siteVisitId
            ? ("Site visit" as const)
            : job.routineId
              ? ("Routine" as const)
              : job.chatTaskId
                ? ("Chat task" as const)
                : ("Job" as const),
          project: null,
          startKey: dateToDayKey(job.startDay),
          dueKey,
          state: job.state,
          doneKey: doneKeyOf(job.state, job.completedAt),
          asked: job.note?.trim() ?? "",
          deliverable: job.deliverable?.trim() ?? "",
          acceptance: job.acceptance?.trim() ?? "",
          // What they wrote sending it in; a progress update when they sent nothing.
          employeeNote:
            joined(job.submissions.map((submission) => submission.note)) || (job.lastUpdateNote?.trim() ?? ""),
          ...handedIn(job.submissions),
          priority: job.priority,
          assignedBy:
            job.assignedBy?.name ?? (job.createdAt >= ASSIGNER_RECORDED_FROM && !job.assignedById ? "Manager" : ""),
        },
      };
    }),
    ...steps.map((step) => {
      const dueKey = step.dueAt ? dayKeyIn(timezone, step.dueAt) : null;
      const doneKey = doneKeyOf(step.state, step.completedAt);
      return {
        order: step.assignee!.order,
        due: dueKey ?? doneKey ?? "",
        row: {
          person: step.assignee!.name,
          title: step.task.name,
          kind: "Project step" as const,
          project: step.project.name,
          startKey: dateToDayKey(step.scheduledFor),
          dueKey,
          state: step.state,
          doneKey,
          asked: step.adminNote?.trim() ?? "",
          deliverable: step.deliverable?.trim() ?? "",
          acceptance: step.acceptance?.trim() ?? "",
          employeeNote:
            joined(step.submissions.map((submission) => submission.note)) || (step.employeeNote?.trim() ?? ""),
          ...handedIn(step.submissions),
          priority: step.priority,
          assignedBy: "Project board",
        },
      };
    }),
  ];

  entries.sort((a, b) => a.order - b.order || a.row.person.localeCompare(b.row.person) || a.due.localeCompare(b.due));
  return entries.map((entry) => entry.row);
}
