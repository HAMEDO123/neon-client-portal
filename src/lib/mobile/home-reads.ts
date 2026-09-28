import { prisma } from "@/lib/db";
import { getAdminBadges } from "@/lib/admin-badges";
import { recentAdminAlerts } from "@/lib/admin-notifications";
import { getDailyProgress, getEmployeeProgress } from "@/lib/analytics-queries";
import { asPercent, PERFORMANCE_PENALTY, PERFORMANCE_THRESHOLD } from "@/lib/analytics";
import { attachmentLabel, isImage } from "@/lib/attachments";
import { sumCounts } from "@/lib/daily-progress";
import { dayBoard } from "@/lib/day-board-queries";
import {
  attentionScore,
  describeDay,
  needingAttention,
  overBy,
  overloaded,
  summarise,
  type PersonDay,
} from "@/lib/day-board";
import { periodOf, previousPeriod } from "@/lib/payroll";
import { getDashboardStats, getProjects } from "@/lib/queries";
import { getTimezone } from "@/lib/settings";
import { pendingSubmissions } from "@/lib/submissions";
import { shiftDayKey, todayKey } from "@/lib/time";
import { describeOutcome, type Outcome } from "@/lib/verification";

// What the manager's Home tab and the three screens beside it read — the
// admin dashboard, Activity, Reviews and Analytics — as the phone reads them.
//
// Every function here is called from registry/home.ts *after* requireAdmin,
// the guard the admin pages sit behind, and each one reads through the very
// lib queries its page calls, in the page's order. What the pages compute
// inline (the analytics page's period and day, its team figures) is repeated
// here with the same lib helpers rather than re-derived, so the app and the
// website cannot come to different numbers.
//
// Wording is left to the app, which speaks English and Arabic: where the
// website prints a sentence built from a judgement (describeDay, the check's
// outcome) the judgement travels as a code the app can translate, beside the
// website's own English for reference.

// --- The dashboard -----------------------------------------------------------

/** The top of the admin dashboard: its four figures, the sidebar's counts, and every project. */
export async function homeOverview() {
  // One after another, like the page (README, "Run queries one after another").
  const stats = await getDashboardStats();
  const badges = await getAdminBadges();
  const projects = await getProjects();

  return {
    stats,
    badges,
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      clientName: project.clientName,
      location: project.location,
      coverImageUrl: project.coverImageUrl,
      publishState: project.publishState,
      pipelineStatus: project.pipelineStatus,
      currentStage: project.currentStage,
      completionPercent: project.completionPercent,
      updatedAt: project.updatedAt,
      approvals: project._count.approvals,
      comments: project._count.comments,
    })),
  };
}

/**
 * What `describeDay` says, as a code: the same conditions in the same order,
 * so the app can say it in either language. The website's English goes with
 * it (`describe`), and the two are one rule.
 */
function describeKind(day: PersonDay): string {
  if (!day.planned) return "unplanned";
  if (day.blocked.length > 0) return "blocked";
  if (day.contradictions.length > 0) return "contradiction";
  if (day.needsManager.length > 0) return "waiting";
  if (overloaded(day)) return "overloaded";
  if (day.unanswered > 0) return "unanswered";
  if (day.blocks > 0 && day.started === day.blocks) return "allStarted";
  return "onTheDay";
}

/**
 * The team's day, as the dashboard's "The day" section reads it: today in the
 * studio's timezone, one row per active person, and the people whose day needs
 * the manager in the order lib/day-board.ts puts them.
 */
export async function homeDay() {
  const timezone = await getTimezone();
  const today = todayKey(timezone);
  const days = await dayBoard(today);

  // The board's rows carry a name; the colour is the one the rest of the
  // admin draws the person in.
  const colours = await prisma.employee.findMany({
    where: { id: { in: days.map((day) => day.employeeId) } },
    select: { id: true, color: true, role: true },
  });
  const byId = new Map(colours.map((row) => [row.id, row]));

  const shape = (day: PersonDay) => ({
    ...day,
    color: byId.get(day.employeeId)?.color ?? "cyan",
    role: byId.get(day.employeeId)?.role ?? null,
    attention: attentionScore(day),
    overloaded: overloaded(day),
    overBy: overBy(day),
    describe: describeDay(day),
    describeKind: describeKind(day),
  });

  return {
    dayKey: today,
    timezone,
    summary: summarise(days),
    // Exactly the list the dashboard shows, in its order.
    pressing: needingAttention(days).map(shape),
    // Everybody, in the board's own order (the order the manager set).
    everyone: days.map(shape),
  };
}

// --- Activity ----------------------------------------------------------------

/** The Activity page: the manager's feed, newest first. */
export async function homeAlerts() {
  const alerts = await recentAdminAlerts();
  const timezone = await getTimezone();

  return {
    timezone,
    unread: alerts.filter((alert) => !alert.readAt).length,
    alerts: alerts.map((alert) => ({
      id: alert.id,
      type: alert.type,
      title: alert.title,
      message: alert.message,
      url: alert.url,
      entryId: alert.entryId,
      employeeId: alert.employeeId,
      employee: alert.employee ? { name: alert.employee.name, color: alert.employee.color } : null,
      readAt: alert.readAt,
      createdAt: alert.createdAt,
    })),
  };
}

/**
 * One alert marked read. The website only offers "Mark all read"; the phone
 * also clears an alert as it is opened, or on a swipe. Only an unread one is
 * touched, so the time it was first read is kept.
 */
export async function markHomeAlertRead(id: string) {
  const result = await prisma.adminNotification.updateMany({
    where: { id, readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: result.count };
}

// --- Reviews -----------------------------------------------------------------

/** The evidence queue, oldest first — what the Reviews page lists. */
export async function homeReviews() {
  const submissions = await pendingSubmissions();
  const timezone = await getTimezone();

  return {
    timezone,
    submissions: submissions.map((submission) => ({
      id: submission.id,
      // A board cell names its step and project; a hand-assigned job has only
      // its own title — the page's own fallbacks.
      name: submission.entry?.task.name ?? submission.assignedTask?.title ?? "Task",
      projectName: submission.entry?.project.name ?? null,
      entryId: submission.entry?.id ?? null,
      assignedTaskId: submission.assignedTask?.id ?? null,
      imageUrl: submission.imageUrl,
      isImage: isImage(submission.imageUrl),
      fileLabel: attachmentLabel(submission.imageUrl),
      note: submission.note,
      createdAt: submission.createdAt,
      employee: submission.employee,
      outcome: submission.outcome,
      outcomeLabel: submission.outcome ? describeOutcome(submission.outcome as Outcome) : null,
      checkedAt: submission.checkedAt,
      checks: submission.checks.map((check) => ({
        id: check.id,
        required: check.required,
        evidence: check.evidence,
        verdict: check.verdict,
        gap: check.gap,
      })),
    })),
  };
}

// --- Analytics ---------------------------------------------------------------

/** A real calendar day, or nothing: "2026-02-31" is not a day. The page's own rule. */
function validDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return shiftDayKey(value, 0) === value ? value : null;
}

/**
 * The Analytics page for one day and one month: the team's day and each
 * person's, and the month's progress with the deduction rule's standing.
 */
export async function homeAnalytics(requestedPeriod: string | null, requestedDay: string | null) {
  const timezone = await getTimezone();
  const today = todayKey(timezone);
  const thisMonth = periodOf(today);
  const period = requestedPeriod && /^\d{4}-\d{2}$/.test(requestedPeriod) ? requestedPeriod : thisMonth;
  const day = validDay(requestedDay) ?? today;

  // One after the other, like the page.
  const daily = await getDailyProgress(day);
  const rows = await getEmployeeProgress(period);

  const teamDay = sumCounts(daily.filter((person) => person.employee.active).map((person) => person.counts));
  const below = rows.filter((row) => row.shortfall && row.employee.active);
  const owing = below.filter((row) => !row.deduction);
  const team = rows.filter((row) => row.counts.total > 0);
  const average = team.length ? team.reduce((sum, row) => sum + row.progress, 0) / team.length : 1;

  return {
    timezone,
    today,
    day,
    live: day === today,
    previousDay: shiftDayKey(day, -1),
    nextDay: shiftDayKey(day, 1),
    period,
    thisMonth,
    previousPeriod: previousPeriod(period),
    target: asPercent(PERFORMANCE_THRESHOLD),
    penalty: PERFORMANCE_PENALTY,
    teamDay,
    daily: daily.map((person) => ({
      employee: person.employee,
      counts: person.counts,
      history: person.history,
      working: person.working,
    })),
    month: {
      team: rows.length,
      average: asPercent(average),
      below: below.length,
      deductionsApplied: rows.filter((row) => row.deduction).length,
      owing: owing.map((row) => ({ id: row.employee.id, name: row.employee.name })),
    },
    rows: rows.map((row) => ({
      // The salary stays on the payroll page; this one never showed it.
      employee: {
        id: row.employee.id,
        name: row.employee.name,
        role: row.employee.role,
        color: row.employee.color,
        active: row.employee.active,
      },
      counts: row.counts,
      progress: asPercent(row.progress),
      timeliness: asPercent(row.timeliness),
      shortfall: row.shortfall,
      deduction: row.deduction,
    })),
  };
}
