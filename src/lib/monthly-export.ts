import { prisma } from "@/lib/db";
import { csvFile, csvRow } from "@/lib/csv";
import { dateToDayKey, dayKeyIn, dayKeyToDate, formatTimeIn, instantAt } from "@/lib/time";

// The month on paper, for the manager: what each person wrote about their days,
// and what work they finished. Two files, asked for apart (2026-11-16).
//
// A calendar month, 1st to last — not the payroll period (5th to 4th). These
// are an account of the work, not of pay, and "November's reports" means the
// days of November.
//
// The builders are pure and take plain rows, so what goes in a column is
// pinned by tests; the loaders below them are the only part that reads the
// database.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `2026-11` from the query string, or this month when it is missing or wrong. */
export function readMonth(raw: string | null | undefined, todayKey: string): string {
  return raw && MONTH.test(raw) ? raw : todayKey.slice(0, 7);
}

/** The first day of the month and of the one after it, as day keys. */
export function monthBounds(month: string): { first: string; next: string } {
  const [year, number] = month.split("-").map(Number);
  const next = number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
  return { first: `${month}-01`, next: `${next}-01` };
}

/** "Sun" for a day key — read at noon UTC so no machine's clock moves the day. */
export function weekdayOf(dayKey: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(
    new Date(`${dayKey}T12:00:00Z`)
  );
}

// ---------------------------------------------------------------------------
// Reports

export type ReportRow = {
  person: string;
  role: string | null;
  dayKey: string;
  text: string;
  /** When it was last written to, already in studio time ("6:42 PM"). */
  lastEdited: string;
};

const REPORT_COLUMNS = ["Employee", "Role", "Date", "Day", "Report", "Last edited"];

/**
 * One row per report: each person's month, day by day, in the team's order.
 * The report stays one cell — its lines are kept, and Excel shows them as
 * lines inside it — because it is read as a paragraph, not as a table.
 *
 * Under them, how many days each person wrote a report.
 */
export function reportsCsv(rows: ReportRow[]): string {
  const lines = [csvRow(REPORT_COLUMNS)];
  for (const row of rows) {
    lines.push(
      csvRow([row.person, row.role ?? "", row.dayKey, weekdayOf(row.dayKey), row.text.trim(), row.lastEdited])
    );
  }

  lines.push("", csvRow(["Employee", "Days reported"]));
  for (const [person, count] of countBy(rows, (row) => row.person)) {
    lines.push(csvRow([person, count]));
  }
  return csvFile(lines);
}

// ---------------------------------------------------------------------------
// Finished work

export type DoneRow = {
  person: string;
  /** The studio day it was approved on. */
  doneKey: string;
  /** The time of day it was approved, studio time. */
  doneAt: string;
  /** The studio day the proof was first sent for review — null when the manager ticked it off with nothing sent. */
  sentKey: string | null;
  title: string;
  kind: "Job" | "Routine" | "Site visit" | "Chat task" | "Project step";
  project: string | null;
  startKey: string | null;
  /** The last day it was due, where one was set. */
  dueKey: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH";
  /** "Manager", an assigner's name, "Project board", or "" when nobody recorded it. */
  assignedBy: string;
};

const DONE_COLUMNS = [
  "Employee",
  "Done on",
  "Day",
  "Approved at",
  "Sent for review",
  "Task",
  "Type",
  "Project",
  "From",
  "Due",
  "Late",
  "Priority",
  "Assigned by",
];

const PRIORITY = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" } as const;

/**
 * Handed in after the day it was due — whole days, the due day itself is not
 * late, as on the cards.
 *
 * Handed in, not approved: the manager approves in batches, often days later,
 * and judged by approval nearly everything in November came out late (109 of
 * 118 on 2026-11-16). The 9 PM cutoff draws the same line — work sent for
 * review by then is in. Only work the manager ticked off with nothing sent
 * falls back to the day it was approved, the one date there is.
 */
export function finishedLate(row: Pick<DoneRow, "doneKey" | "sentKey" | "dueKey">): boolean {
  return row.dueKey != null && (row.sentKey ?? row.doneKey) > row.dueKey;
}

/**
 * One row per finished task: each person's month, in the order it was
 * approved. "Done" is approved by the manager — work sent in and still waiting
 * is not finished, and is not here.
 *
 * Under them, each person's count, and how many of those came in late.
 */
export function doneTasksCsv(rows: DoneRow[]): string {
  const lines = [csvRow(DONE_COLUMNS)];
  for (const row of rows) {
    lines.push(
      csvRow([
        row.person,
        row.doneKey,
        weekdayOf(row.doneKey),
        row.doneAt,
        row.sentKey ?? "",
        row.title,
        row.kind,
        row.project ?? "",
        row.startKey ?? "",
        row.dueKey ?? "",
        finishedLate(row) ? "Late" : "",
        PRIORITY[row.priority],
        row.assignedBy,
      ])
    );
  }

  lines.push("", csvRow(["Employee", "Tasks done", "Of them late"]));
  const late = countBy(rows.filter(finishedLate), (row) => row.person);
  for (const [person, count] of countBy(rows, (row) => row.person)) {
    lines.push(csvRow([person, count, late.get(person) ?? 0]));
  }
  return csvFile(lines);
}

/** Counts in the order each key first appears, which is the team's order. */
function countBy<T>(rows: T[], key: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return counts;
}

// ---------------------------------------------------------------------------
// Reading the month

/** Team order first — the order every screen lists people in — then the day. */
const personOrder = [{ employee: { order: "asc" as const } }, { employee: { name: "asc" as const } }];

export async function loadMonthReports(month: string, timezone: string): Promise<ReportRow[]> {
  const { first, next } = monthBounds(month);
  const reports = await prisma.dailyReport.findMany({
    // Anybody who wrote one, including somebody who has left since.
    where: { day: { gte: dayKeyToDate(first), lt: dayKeyToDate(next) }, text: { not: "" } },
    orderBy: [...personOrder, { day: "asc" }],
    select: { day: true, text: true, updatedAt: true, employee: { select: { name: true, role: true } } },
  });
  return reports.map((report) => ({
    person: report.employee.name,
    role: report.employee.role,
    dayKey: dateToDayKey(report.day)!,
    text: report.text,
    lastEdited: formatTimeIn(timezone, report.updatedAt) ?? "",
  }));
}

/**
 * When `assignedById` started being written (2026-11-14, 14:16 studio time).
 * A job with none after it was the manager's; before it, nobody knows, and the
 * file says nothing rather than guess.
 */
const ASSIGNER_RECORDED_FROM = new Date("2026-11-14T11:16:25Z");

export async function loadMonthDone(month: string, timezone: string): Promise<DoneRow[]> {
  const { first, next } = monthBounds(month);
  // Approval is an instant; the month is studio days.
  const from = instantAt(first, "00:00", timezone) ?? dayKeyToDate(first);
  const until = instantAt(next, "00:00", timezone) ?? dayKeyToDate(next);
  const when = { state: "DONE" as const, completedAt: { gte: from, lt: until } };
  // The first proof sent in, which is when the work was handed in.
  const firstSent = { orderBy: { createdAt: "asc" as const }, take: 1, select: { createdAt: true } };
  const sentKeyOf = (submissions: { createdAt: Date }[]) =>
    submissions[0] ? dayKeyIn(timezone, submissions[0].createdAt) : null;

  const [jobs, steps] = await Promise.all([
    prisma.assignedTask.findMany({
      where: when,
      select: {
        title: true,
        startDay: true,
        endDay: true,
        completedAt: true,
        priority: true,
        createdAt: true,
        routineId: true,
        siteVisitId: true,
        chatTaskId: true,
        assignedById: true,
        assignedBy: { select: { name: true } },
        submissions: firstSent,
        employee: { select: { name: true, order: true } },
      },
    }),
    prisma.projectTaskEntry.findMany({
      where: { ...when, assigneeId: { not: null } },
      select: {
        completedAt: true,
        dueAt: true,
        scheduledFor: true,
        priority: true,
        task: { select: { name: true } },
        submissions: firstSent,
        project: { select: { name: true } },
        assignee: { select: { name: true, order: true } },
      },
    }),
  ]);

  // Each row with what it is sorted by beside it, not in it.
  const entries: { order: number; at: number; row: DoneRow }[] = [
    ...jobs.map((job) => ({
      order: job.employee.order,
      at: job.completedAt!.getTime(),
      row: {
        person: job.employee.name,
        doneKey: dayKeyIn(timezone, job.completedAt!),
        doneAt: formatTimeIn(timezone, job.completedAt) ?? "",
        sentKey: sentKeyOf(job.submissions),
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
        dueKey: dateToDayKey(job.endDay),
        priority: job.priority,
        assignedBy:
          job.assignedBy?.name ?? (job.createdAt >= ASSIGNER_RECORDED_FROM && !job.assignedById ? "Manager" : ""),
      },
    })),
    ...steps.map((step) => ({
      order: step.assignee!.order,
      at: step.completedAt!.getTime(),
      row: {
        person: step.assignee!.name,
        doneKey: dayKeyIn(timezone, step.completedAt!),
        doneAt: formatTimeIn(timezone, step.completedAt) ?? "",
        sentKey: sentKeyOf(step.submissions),
        title: step.task.name,
        kind: "Project step" as const,
        project: step.project.name,
        startKey: dateToDayKey(step.scheduledFor),
        // Only a deadline somebody set on the step itself. The stage plan's
        // countdown is worked out from the whole project and is not repeated
        // here — a second reading of it is the one that drifts.
        dueKey: step.dueAt ? dayKeyIn(timezone, step.dueAt) : null,
        priority: step.priority,
        assignedBy: "Project board",
      },
    })),
  ];

  entries.sort((a, b) => a.order - b.order || a.row.person.localeCompare(b.row.person) || a.at - b.at);
  return entries.map((entry) => entry.row);
}
