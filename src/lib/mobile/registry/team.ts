import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-guard";
import {
  createEmployeeAccount,
  resetEmployeePassword,
  revokeEmployeeAccount,
  setEmployeeActive,
  setEmployeePhoto,
  updateEmployeeAccount,
} from "@/lib/actions/admin-employee-actions";
import { giveWarning, removeWarning } from "@/lib/actions/warning-actions";
import { applyDayPlan, planEmployeeDay, saveDayPlanEdits } from "@/lib/actions/day-plan-actions";
import {
  correctReceipt,
  deleteAttendance,
  setAttendance,
  setDeviceUserId,
  setEmployeePay,
} from "@/lib/actions/operations-actions";
import { getAttendanceForPeriod, getPayrollForPeriod, getReceiptsForPeriod } from "@/lib/payroll-queries";
import { periodLabel, periodOf, previousPeriod } from "@/lib/payroll";
import { salesCountsForMonth, monthSalesFor } from "@/lib/sales-queries";
import { WARNING_LIMIT } from "@/lib/warnings";
import { getTimezone, getWorkHours } from "@/lib/settings";
import { dayKeyToDate, formatDayIn, todayKey } from "@/lib/time";
import { nextWorkingDay } from "@/lib/work-hours";
import { getDayPlan } from "@/lib/day-plan-store";
import { isAiConfigured } from "@/lib/ai/client";
import { performanceFor, sinceDays, WINDOW_DAYS } from "@/lib/performance-queries";
import { facesFor } from "@/lib/faces";
import { refreshTeamLocations, setOfficeLocation, teamLocations } from "@/lib/mobile/location-service";
import { bool, guarded, guardedAction, optParam, param, str, type ActionRegistry, type ReadRegistry } from "@/lib/mobile/rpc";

// The "team" area of the phone API: employees, payroll, and the map of where
// the team is. See lib/mobile/rpc.ts: keys are "team/<name>"; every read is
// guarded(requireAdmin, …), matching the website's admin-only employees and
// payroll pages; every action calls the website's own server action, so its
// guard, rules and notifications are the website's own — except the map's,
// which have no website counterpart and are guardedAction(requireAdmin, …).

export const reads: ReadRegistry = {
  // Mirrors src/app/admin/(dashboard)/employees/page.tsx.
  "team/employees": guarded(requireAdmin, async () => {
    const employees = await prisma.employee.findMany({
      orderBy: [{ active: "desc" }, { order: "asc" }],
      include: {
        _count: { select: { tasks: true, assignedEntries: true, subscriptions: true, warnings: true } },
      },
    });
    const timezone = await getTimezone();
    const sold = await salesCountsForMonth(periodOf(todayKey(timezone)));

    return {
      warningLimit: WARNING_LIMIT,
      employees: employees.map((employee) => ({
        id: employee.id,
        name: employee.name,
        role: employee.role,
        email: employee.email,
        phone: employee.phone,
        employeeCode: employee.employeeCode,
        active: employee.active,
        // Their face, or null for initials on `color` (lib/faces.ts).
        photoUrl: employee.photoUrl,
        color: employee.color,
        // The manager's own row (paired to the attendance device) is listed
        // here but is not the team; the phone labels it and leaves it out of
        // the team count, which then agrees with Payroll.
        accessRole: employee.accessRole,
        lastLoginAt: employee.lastLoginAt,
        monthlySalesTarget: employee.monthlySalesTarget,
        taskCount: employee._count.tasks,
        deviceCount: employee._count.subscriptions,
        warningCount: employee._count.warnings,
        sold: sold.get(employee.id) ?? 0,
      })),
    };
  }),

  // Mirrors src/app/admin/(dashboard)/employees/[id]/page.tsx.
  "team/employee": guarded(requireAdmin, async (params) => {
    const id = param(params, "id");
    const employee = await prisma.employee.findUnique({
      where: { id },
      include: {
        subscriptions: { where: { active: true }, orderBy: { createdAt: "desc" } },
        warnings: { orderBy: { createdAt: "asc" }, select: { id: true, reason: true, createdAt: true } },
        _count: { select: { notifications: true, assignedEntries: true } },
      },
    });
    if (!employee) return null;

    const timezone = await getTimezone();
    const hours = await getWorkHours();
    const today = todayKey(timezone);
    const tomorrow = nextWorkingDay(hours, today);
    const tomorrowLabel = formatDayIn(timezone, dayKeyToDate(tomorrow)) ?? tomorrow;
    const period = periodOf(today);
    const sales = await monthSalesFor(employee.id, period);
    const colleagues = await prisma.employee.findMany({
      where: { active: true, accessRole: "EMPLOYEE", NOT: { id: employee.id } },
      select: { id: true, name: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
    const planToday = await getDayPlan(employee.id, today);
    const planTomorrow = await getDayPlan(employee.id, tomorrow);
    const performance = await performanceFor(employee.id, sinceDays());

    return {
      warningLimit: WARNING_LIMIT,
      employee: {
        id: employee.id,
        name: employee.name,
        email: employee.email,
        role: employee.role,
        phone: employee.phone,
        employeeCode: employee.employeeCode,
        active: employee.active,
        photoUrl: employee.photoUrl,
        color: employee.color,
        accessRole: employee.accessRole,
        createdAt: employee.createdAt,
        lastLoginAt: employee.lastLoginAt,
        monthlySalesTarget: employee.monthlySalesTarget,
        canReadWhatsApp: employee.canReadWhatsApp,
        canAssignTasks: employee.canAssignTasks,
        canLogSiteVisits: employee.canLogSiteVisits,
        playbook: employee.playbook,
        skills: employee.skills,
        examples: employee.examples,
        dailyCapacityMinutes: employee.dailyCapacityMinutes,
        reviewerId: employee.reviewerId,
        deviceCount: employee.subscriptions.length,
        notificationCount: employee._count.notifications,
      },
      warnings: employee.warnings,
      colleagues,
      today,
      tomorrow,
      tomorrowLabel,
      aiConfigured: isAiConfigured(),
      plans: { today: planToday, tomorrow: planTomorrow },
      sales: { projects: sales.projects, target: sales.target, period },
      performance,
      performanceDays: WINDOW_DAYS,
    };
  }),

  // Where the team is, for the manager's map (lib/staff-location.ts): the
  // people the team count above counts — active, accessRole EMPLOYEE — each
  // with where their phone last said it was: only inside today's working
  // window, only the latest, and nothing once the fingerprint device has seen
  // them clock out. A state says what the phone or the device reported, never
  // that anybody is absent. A read and nothing more: it changes no row, not
  // even a phone's "last asked".
  // → { open, startsAt, endsAt, nextStartsAt, office: { latitude, longitude } | null,
  //     people: [{ id, name, photoUrl, role, state, latitude, longitude, accuracy,
  //     fixedAt, precise, permission, atOffice, metresFromOffice, arrivedAt, departedAt }] }
  "team/locations": guarded(requireAdmin, async () => teamLocations()),

  // Mirrors src/app/admin/(dashboard)/payroll/page.tsx.
  "team/payroll": guarded(requireAdmin, async (params) => {
    const timezone = await getTimezone();
    const thisMonth = periodOf(todayKey(timezone));
    const requested = optParam(params, "period");
    const period = requested && /^\d{4}-\d{2}$/.test(requested) ? requested : thisMonth;
    const isThisMonth = period === thisMonth;

    const rows = await getPayrollForPeriod(period);
    const attendance = await getAttendanceForPeriod(period);
    const receipts = await getReceiptsForPeriod(period);
    const employees = await prisma.employee.findMany({
      where: { active: true, accessRole: "EMPLOYEE" },
      orderBy: { order: "asc" },
      select: { id: true, name: true, deviceUserId: true, photoUrl: true },
    });
    // Each payroll row's face, beside the row rather than in
    // getPayrollForPeriod, which the website reads and draws no faces from.
    const faces = await facesFor(rows.map((row) => row.employee.id));

    const totals = rows.reduce(
      (sum, row) => ({
        cut: sum.cut + row.breakdown.totalCut,
        receipts: sum.receipts + row.breakdown.receiptTotal,
        final: sum.final + row.breakdown.finalPay,
      }),
      { cut: 0, receipts: 0, final: 0 }
    );

    return {
      period,
      periodLabel: periodLabel(period),
      previousPeriod: previousPeriod(period),
      thisMonth,
      isThisMonth,
      totals: { ...totals, team: rows.length },
      rows: rows.map((row) => ({ ...row, employee: { ...row.employee, photoUrl: faces[row.employee.id] ?? null } })),
      employees,
      attendance: attendance.map((record) => ({
        id: record.id,
        day: record.day,
        employeeId: record.employee.id,
        employeeName: record.employee.name,
        delayHours: record.delayHours,
        note: record.note,
      })),
      receipts: receipts.map((receipt) => ({
        id: receipt.id,
        employeeId: receipt.employee.id,
        employeeName: receipt.employee.name,
        imageUrl: receipt.imageUrl,
        summary: receipt.summary,
        aiNotes: receipt.aiNotes,
        vendor: receipt.vendor,
        rawAmount: receipt.rawAmount,
        countedAmount: receipt.countedAmount,
      })),
    };
  }),
};

export const actions: ActionRegistry = {
  "team/createEmployee": async (input) => createEmployeeAccount(input.form),
  "team/updateEmployee": async (input) => updateEmployeeAccount(str(input.args[0], "id"), input.form),
  "team/setEmployeeActive": async (input) =>
    setEmployeeActive(str(input.args[0], "id"), bool(input.args[1])),
  "team/resetPassword": async (input) => resetEmployeePassword(str(input.args[0], "id"), input.form),
  "team/revokeAccount": async (input) => revokeEmployeeAccount(str(input.args[0], "id")),

  // Somebody's face, set by the manager — the same `setEmployeePhoto` the
  // PhotoPicker on /admin/employees/[id] calls, `requireAdmin` and all, so a
  // team member's token is refused here however the request is written. The
  // form's `photo` is the picture; no `photo` at all means "take it off".
  // Answers with the new URL so the phone can draw it without a second read.
  "team/employees/photo": async (input) => {
    const id = str(input.args[0], "employeeId");
    await setEmployeePhoto(id, input.form);
    const row = await prisma.employee.findUnique({ where: { id }, select: { photoUrl: true } });
    return { photoUrl: row?.photoUrl ?? null };
  },

  "team/giveWarning": async (input) => giveWarning(str(input.args[0], "employeeId"), input.form),
  "team/removeWarning": async (input) =>
    removeWarning(str(input.args[0], "employeeId"), str(input.args[1], "warningId")),

  "team/planDay": async (input) => planEmployeeDay(str(input.args[0], "employeeId"), str(input.args[1], "dayKey")),
  "team/saveDayPlan": async (input) =>
    saveDayPlanEdits(
      str(input.args[0], "employeeId"),
      str(input.args[1], "dayKey"),
      (input.args[2] as { from: string; to: string; keep: boolean }[]) ?? []
    ),
  "team/applyDayPlan": async (input) => applyDayPlan(str(input.args[0], "employeeId"), str(input.args[1], "dayKey")),

  // The map's Refresh: a silent push to the phones that have gone quiet —
  // still shared, switch not off, no position for two minutes and not asked
  // in the last two. Outside the working window it asks nobody. → { asked }
  "team/locations/refresh": guardedAction(requireAdmin, async () => refreshTeamLocations()),

  // Where the office is, for "at the office" on the map: args [latitude,
  // longitude] sets it, [] or [null] clears it. → { office: { latitude, longitude } | null }
  "team/locations/office": guardedAction(requireAdmin, async ({ args }) => setOfficeLocation(args)),

  "team/setEmployeePay": async (input) => setEmployeePay(str(input.args[0], "id"), input.form),
  "team/setAttendance": async (input) => setAttendance(input.form),
  "team/deleteAttendance": async (input) => deleteAttendance(str(input.args[0], "id")),
  "team/setDeviceUserId": async (input) => setDeviceUserId(str(input.args[0], "employeeId"), input.form),
  "team/correctReceipt": async (input) => correctReceipt(str(input.args[0], "id"), input.form),
};
