import { requireAdmin, requireSiteVisitor } from "@/lib/admin-guard";
import { prisma } from "@/lib/db";
import { getTimezone } from "@/lib/settings";
import { dayKeyToDate, todayKey } from "@/lib/time";
import { allSiteVisits, projectsForVisits, siteVisitsFor } from "@/lib/site-visit-queries";
import { VISIT_STATES } from "@/lib/site-visits";
import { attendanceMonthFor, attendanceOverview } from "@/lib/mobile/ops-attendance";
import { opsAutomationPreview, opsSettings } from "@/lib/mobile/ops-settings";
import {
  addDeviceUser,
  clearDeviceAttendanceLog,
  decideSupplyRequest,
  deleteAttendance,
  deleteDeviceUser,
  setAttendance,
  setDeviceClockNow,
  setDeviceUserId,
  syncAttendanceNow,
} from "@/lib/actions/operations-actions";
import { deleteSiteVisit, reportSiteVisit, scheduleSiteVisit, updateSiteVisit } from "@/lib/actions/site-visit-actions";
import { savePlanningNotes, saveWorkHours } from "@/lib/actions/settings-actions";
import { saveTimezone } from "@/lib/actions/whatsapp-actions";
import {
  createAutomationRule,
  deleteAutomationRule,
  setAutomationSwitch,
  updateAutomationRule,
} from "@/lib/actions/automation-actions";
import { bool, guarded, oneOf, optParam, str, type ActionRegistry, type ReadRegistry } from "@/lib/mobile/rpc";
import type { SupplyRequestStatus } from "@/generated/prisma/enums";

// The "ops" area of the phone API: attendance, requests (manager side), site
// visits (both sides) and settings. See lib/mobile/rpc.ts: keys are
// "ops/<name>"; every read is guarded(<the website page's guard>, …); an
// action calls the website's own server action.

export const reads: ReadRegistry = {
  // Mirrors admin/(dashboard)/attendance's device panel and pairing list.
  "ops/attendanceOverview": guarded(requireAdmin, async () => attendanceOverview()),

  // Mirrors the same page's month grid, ?month=YYYY-MM.
  "ops/attendanceMonth": guarded(requireAdmin, async (params) => attendanceMonthFor(optParam(params, "month"))),

  // Mirrors admin/(dashboard)/requests: today's reports and supply requests.
  "ops/requests": guarded(requireAdmin, async () => {
    const requests = await prisma.supplyRequest.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200,
      include: { employee: { select: { id: true, name: true, role: true } } },
    });

    const timezone = await getTimezone();
    const today = todayKey(timezone);
    const team = await prisma.employee.findMany({
      where: { active: true, accessRole: "EMPLOYEE" },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true, role: true },
    });
    const reports = await prisma.dailyReport.findMany({
      where: { day: dayKeyToDate(today) },
      select: { employeeId: true, text: true, updatedAt: true },
    });

    return {
      pending: requests.filter((request) => request.status === "PENDING"),
      decided: requests.filter((request) => request.status !== "PENDING"),
      team,
      reports,
    };
  }),

  // Mirrors admin/(dashboard)/site-visits: every visit, for the manager.
  "ops/siteVisits": guarded(requireAdmin, async () => allSiteVisits()),

  // The signed-in team member's own diary — the same rule the Tasks tab's
  // site-visits view follows: canLogSiteVisits, and never the manager (who
  // reads "ops/siteVisits" instead, and answers for nobody's visit).
  "ops/mySiteVisits": guarded(requireSiteVisitor, async (_params, actor) => {
    if (actor.type !== "EMPLOYEE") throw new Error("Unauthorized");
    const [visits, projects] = await Promise.all([siteVisitsFor(actor.id), projectsForVisits()]);
    return { visits, projects };
  }),

  // Mirrors admin/(dashboard)/settings, minus the delivery process (the tasks
  // area's ProcessSettingsView owns process sections, stage periods and what
  // each kind of work needs).
  "ops/settings": guarded(requireAdmin, async () => opsSettings()),

  // The rules preview: runs today's rules and writes nothing (?preview=rules
  // on the website). A read, not an action, for exactly that reason.
  "ops/automationPreview": guarded(requireAdmin, async () => opsAutomationPreview()),
};

export const actions: ActionRegistry = {
  // --- Attendance ------------------------------------------------------------
  "ops/setAttendance": async (input) => setAttendance(input.form),
  "ops/deleteAttendance": async (input) => deleteAttendance(str(input.args[0], "id")),
  "ops/setDeviceUserId": async (input) => setDeviceUserId(str(input.args[0], "employeeId"), input.form),
  "ops/syncAttendanceNow": async () => syncAttendanceNow(),
  "ops/setDeviceClockNow": async () => setDeviceClockNow(),
  "ops/addDeviceUser": async (input) => addDeviceUser(input.form),
  "ops/deleteDeviceUser": async (input) => deleteDeviceUser(input.form),
  "ops/clearDeviceAttendanceLog": async (input) => clearDeviceAttendanceLog(input.form),

  // --- Requests ----------------------------------------------------------------
  "ops/decideSupplyRequest": async (input) => {
    const id = str(input.args[0], "id");
    const status = oneOf(input.args[1], ["PENDING", "APPROVED", "REJECTED", "PURCHASED"] as const, "status");
    return decideSupplyRequest(id, status as SupplyRequestStatus, input.form);
  },

  // --- Site visits ---------------------------------------------------------
  "ops/scheduleSiteVisit": async (input) => scheduleSiteVisit(input.form),
  "ops/updateSiteVisit": async (input) => updateSiteVisit(str(input.args[0], "id"), input.form),
  "ops/reportSiteVisit": async (input) => {
    const id = str(input.args[0], "id");
    const state = oneOf(input.args[1], VISIT_STATES, "state");
    return reportSiteVisit(id, state, input.form);
  },
  "ops/deleteSiteVisit": async (input) => deleteSiteVisit(str(input.args[0], "id")),

  // --- Settings --------------------------------------------------------------
  "ops/saveWorkHours": async (input) => saveWorkHours(input.form),
  "ops/savePlanningNotes": async (input) => savePlanningNotes(input.form),
  "ops/saveTimezone": async (input) => saveTimezone(input.form),
  "ops/createAutomationRule": async (input) => createAutomationRule(input.form),
  "ops/updateAutomationRule": async (input) => updateAutomationRule(str(input.args[0], "id"), input.form),
  "ops/deleteAutomationRule": async (input) => deleteAutomationRule(str(input.args[0], "id")),
  "ops/setAutomationSwitch": async (input) => setAutomationSwitch(bool(input.args[0])),
};
