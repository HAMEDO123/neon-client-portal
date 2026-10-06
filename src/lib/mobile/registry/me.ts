import { requireEmployee } from "@/lib/employee-session";
import { requireTaskAssigner } from "@/lib/admin-guard";
import { prisma } from "@/lib/db";
import { getTimezone } from "@/lib/settings";
import { todayKey, dayKeyToDate } from "@/lib/time";
import { getMyReceipts } from "@/lib/payroll-queries";
import { periodOf, periodLabel, RECEIPT_CAP } from "@/lib/payroll";
import { getPreferences } from "@/lib/notifications/engine";
import { deviceLabel } from "@/lib/devices";
import { myAssignedTasks, myAssignedTask, assignedTasksForWeek } from "@/lib/assigned-tasks";
import { submissionsForAssignedTask } from "@/lib/submissions";
import { openFollowUpForTask } from "@/lib/follow-up-queue";
import { answerFollowUp } from "@/lib/actions/follow-up-actions";
import { weekDayKeys, weekStartKey, weekLabel } from "@/lib/week";
import { createSupplyRequest, cancelSupplyRequest, submitReceipt, deleteReceipt, saveDailyReport } from "@/lib/actions/operations-actions";
import { saveNotificationPreferences } from "@/lib/actions/employee-actions";
import { setDeviceActive, forgetDevice } from "@/lib/actions/device-actions";
import { setMyAssignedTaskStatus } from "@/lib/actions/my-assigned-actions";
import {
  createAssignedTask,
  updateAssignedTask,
  deleteAssignedTask,
  setAssignedTaskState,
} from "@/lib/actions/assigned-task-actions";
import { guarded, guardedAction, heard, param, optParam, str, oneOf, bool, RpcError, type ActionRegistry, type ReadRegistry } from "@/lib/mobile/rpc";
import { locationPlanFor, reportLocation, setLocationPermission } from "@/lib/mobile/location-service";
import { PERMISSIONS } from "@/lib/staff-location";
import { notifyAdmin } from "@/lib/admin-notifications";
import { shoppingDedupeKey, shoppingLabel, shoppingMessage } from "@/lib/office-shopping";
import { recordShopFetch, saveShopSession, shopSession, type ShopCookie } from "@/lib/office-shop-account";
import { readShopStorage } from "@/lib/office-shop-storage";
import { requireAdmin } from "@/lib/admin-guard";
import type { TaskState } from "@/generated/prisma/enums";

// The "me" area of the phone API: the signed-in employee's own things. See
// lib/mobile/rpc.ts: keys are "me/<name>"; every read is guarded(<the website
// page's guard>, …); an action calls the website's own server action, or is
// guardedAction(…) when it calls a lib function directly.

export const reads: ReadRegistry = {
  // What this person's More tab offers: the three permissions the manager
  // ticks one person at a time (lib/admin-guard.ts).
  "me/permissions": guarded(requireEmployee, async (_params, me) => ({
    canReadWhatsApp: me.canReadWhatsApp,
    canAssignTasks: me.canAssignTasks,
    canLogSiteVisits: me.canLogSiteVisits,
  })),

  // The office's shop sign-in, so a phone opens the shop already signed in to
  // the manager's account and the one cart.
  //
  // A session, not a password: Yaser Mall signs in with a phone number and an
  // SMS code, so there is nothing else to hand over. lib/office-shop-account.ts
  // has the whole of why.
  //
  // Every fetch is recorded against the person who asked. That record is the
  // real protection — encryption only covers a stolen database copy.
  "me/shopping/session": guarded(requireEmployee, async (_params, me) => {
    const session = await shopSession();
    if (!session) {
      // Not an error: nobody has shared one yet, or SESSION_SECRET has changed
      // since. The app says so rather than failing on the tap.
      return {
        session: null,
        why: "The office isn't signed in to the shop yet. Ask the manager to sign in and share it.",
      };
    }

    await recordShopFetch(me.id, me.name);
    return { session, why: null };
  }),

  // Jobs handed out by hand (AssignedTask): src/lib/assigned-tasks.ts
  // `myAssignedTasks`, the same rows `/employee/tasks` folds into its list —
  // ?filter=open|completed|all, "open" by default.
  "me/jobs": guarded(requireEmployee, async (params, me) => {
    const filter = optParam(params, "filter") ?? "open";
    const jobs = await myAssignedTasks(me.id, { includeDone: true });
    const filtered = jobs.filter((job) =>
      filter === "completed" ? job.state === "DONE" : filter === "all" ? true : job.state !== "DONE"
    );
    return { jobs: filtered };
  }),

  // The one open question the day owes about this task, as `/employee/tasks/[id]`
  // reads it: `openFollowUpForTask` — unanswered and already asked. `null` when
  // there is nothing to answer right now.
  "me/tasks/followup": guarded(requireEmployee, async (params, me) => {
    const entryId = param(params, "entryId");
    return openFollowUpForTask(me.id, entryId);
  }),

  // One job, as `/employee/assigned/[id]` reads it, plus what has been sent
  // for it so far. Scoped to this employee: somebody else's job id is simply
  // not found, never refused.
  "me/jobs/detail": guarded(requireEmployee, async (params, me) => {
    const id = param(params, "id");
    const job = await myAssignedTask(me.id, id);
    if (!job) throw new RpcError("Task not found.", 404);
    const submissions = await submissionsForAssignedTask(job.id);
    return { job, submissions };
  }),

  // Everything `/employee/requests` shows across its three tabs, read once:
  // supply requests, this month's receipts, and today's report if it was
  // written. One read rather than three, because the whole tab is small.
  "me/requests": guarded(requireEmployee, async (_params, me) => {
    const timezone = await getTimezone();
    const dayKey = todayKey(timezone);
    const period = periodOf(dayKey);

    const supplyRequests = await prisma.supplyRequest.findMany({
      where: { employeeId: me.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      // `item` is a headline over these, as on the manager's list.
      include: { lines: { orderBy: { position: "asc" } } },
    });
    const receipts = await getMyReceipts(me.id, period);
    const report = await prisma.dailyReport.findUnique({
      where: { employeeId_day: { employeeId: me.id, day: dayKeyToDate(dayKey) } },
      select: { text: true, updatedAt: true },
    });

    return {
      supplyRequests,
      receipts,
      receiptCap: RECEIPT_CAP,
      period,
      periodLabel: periodLabel(period),
      report,
    };
  }),

  // `/employee/profile`: who this is, what to be notified about, and which
  // devices are registered. Web push subscriptions themselves are a browser
  // thing the app does not create, so only the list is shown here — the app
  // may still switch one off or forget it.
  "me/profile": guarded(requireEmployee, async (_params, me) => {
    const [preferences, devices, timezone] = await Promise.all([
      getPreferences(me.id),
      prisma.pushSubscription.findMany({
        where: { employeeId: me.id },
        orderBy: [{ active: "desc" }, { lastUsedAt: "desc" }, { createdAt: "desc" }],
        select: { id: true, userAgent: true, active: true, lastUsedAt: true, createdAt: true },
      }),
      getTimezone(),
    ]);

    return {
      employee: {
        id: me.id,
        name: me.name,
        role: me.role,
        email: me.email,
        phone: me.phone,
        employeeCode: me.employeeCode,
        photoUrl: me.photoUrl,
      },
      preferences,
      devices: devices.map((device) => ({
        id: device.id,
        label: deviceLabel(device.userAgent),
        active: device.active,
        lastUsedAt: device.lastUsedAt,
        addedAt: device.createdAt,
      })),
      timezone,
    };
  }),

  // The Assign view (`components/tasks/assign-work.tsx` on the web): the team
  // to hand work to, behind the same guard the website form is behind.
  "me/assign/team": guarded(requireTaskAssigner, async () => ({
    team: await prisma.employee.findMany({
      where: { active: true, accessRole: "EMPLOYEE" },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true, color: true, role: true, photoUrl: true },
    }),
  })),

  // Whether this phone should share its position now, for the manager's map
  // (lib/staff-location.ts): only inside today's working window, and not once
  // the fingerprint device has seen this person clock out.
  // → { sharing, reason: "before-hours" | "after-hours" | "day-off" |
  //   "clocked-out" | null (null exactly when sharing), startsAt, endsAt
  //   (today's window, null on a day off), nextStartsAt (the next start after now),
  //   required (whether the studio requires location to use the app at all),
  //   fine: { on, amount, startsOn } (the 1 JOD a working day without location;
  //   startsOn is this person's first working day that counts, YYYY-MM-DD, null
  //   until they have been told or while it is off), sharedToday (a position from
  //   this phone got through today), finedThisMonth: ["YYYY-MM-DD", …] (charged,
  //   not cancelled) }
  "me/location": guarded(requireEmployee, async (_params, me) => locationPlanFor(me.id)),

  // That week's jobs, whoever they are for — the same week `assignedTasksForWeek`
  // hands the web's Assign view, ?week=YYYY-MM-DD (a Sunday; any day in the
  // week works, lib/week.ts resolves it).
  "me/assign/week": guarded(requireTaskAssigner, async (params) => {
    const timezone = await getTimezone();
    const requested = optParam(params, "week");
    const anchor = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : todayKey(timezone);
    const keys = weekDayKeys(anchor);

    return {
      weekStart: weekStartKey(anchor),
      weekLabel: weekLabel(keys),
      todayKey: todayKey(timezone),
      tasks: await assignedTasksForWeek(anchor),
    };
  }),
};

export const actions: ActionRegistry = {
  // Answering what the day asked — follow-up-reply.tsx's four choices (or the
  // end-of-block four), plus the note some of them ask for.
  "me/tasks/followup/answer": async (input) =>
    answerFollowUp(str(input.args[0], "followUpId"), str(input.args[1], "answer"), typeof input.args[2] === "string" ? input.args[2] : undefined),

  // Jobs handed out by hand — the employee's own moves. "Done" never appears:
  // canMove refuses it from this side exactly as the website does.
  "me/jobs/status": async (input) =>
    setMyAssignedTaskStatus(str(input.args[0], "id"), oneOf(input.args[1], ["TODO", "IN_PROGRESS"], "state") as TaskState),

  // Supplies, receipts, the daily report.
  "me/requests/supply/create": async (input) => createSupplyRequest(input.form),
  "me/requests/supply/cancel": async (input) => cancelSupplyRequest(str(input.args[0], "id")),
  // Answers with its refusal (lib/refusal.ts); `heard` sends the app the same
  // `{ error }` a thrown sentence always became.
  "me/requests/receipt/submit": async (input) => heard(await submitReceipt(input.form)),
  "me/requests/receipt/delete": async (input) => deleteReceipt(str(input.args[0], "id")),
  "me/requests/report/save": async (input) => saveDailyReport(input.form),

  // Profile: notification preferences and this account's devices.
  "me/profile/preferences": async (input) => saveNotificationPreferences(input.form),
  "me/profile/device/active": async (input) => {
    const [id, active] = input.args;
    return setDeviceActive(str(id, "id"), active === true);
  },
  "me/profile/device/forget": async (input) => forgetDevice(str(input.args[0], "id")),

  // Handing work out — requireTaskAssigner lives inside each of these, so an
  // employee without the permission is refused by the action itself.
  "me/assign/create": async (input) => createAssignedTask(input.form),
  "me/assign/update": async (input) => updateAssignedTask(str(input.args[0], "id"), input.form),
  // The manager hands their signed-in shop session to the rest of the office.
  //
  // `requireAdmin`, not `requireStaff`: this *is* the office's sign-in. An
  // employee's phone reads it; only the manager's may replace it, or anybody
  // could point the whole studio at an account of their own.
  // args: [cookies, site, storage]. `storage` is the shop's local-storage
  // entries — Yaser Mall keeps its sign-in token there, not in a cookie, so a
  // share without it signs nobody in (lib/office-shop-storage.ts).
  "me/shopping/share": guardedAction(requireAdmin, async (input) => {
    const cookies = readCookies(input.args[0]);
    const storage = readShopStorage(input.args[2]);
    if (cookies.length === 0 && storage.length === 0) {
      throw new RpcError("Sign in to the shop first — there is no session to share yet.", 400);
    }

    const site = typeof input.args[1] === "string" ? input.args[1].slice(0, 200) : null;
    await saveShopSession(cookies, "Manager", site, storage);
    return { ok: true, cookies: cookies.length, storage: storage.length };
  }),

  "me/assign/delete": async (input) => deleteAssignedTask(str(input.args[0], "id")),
  "me/assign/state": async (input) =>
    setAssignedTaskState(str(input.args[0], "id"), oneOf(input.args[1], ["TODO", "IN_PROGRESS", "DONE"], "state")),

  // A position from this phone, for the manager's map: args [latitude,
  // longitude, accuracy (metres), fixedAt (ISO), precise]. Kept only while
  // the plan says sharing and only if it was taken inside the window — the
  // latest one, never a trail. Answers with the same plan as `me/location`,
  // so the phone stops the moment `sharing` is false — `fine`, `sharedToday`
  // and `finedThisMonth` included, read after this position was counted.
  "me/location/report": guardedAction(requireEmployee, async ({ args }, me) => reportLocation(me.id, args)),

  // The phone's location permission as iOS reports it: args [permission,
  // precise], permission always | when-in-use | denied | restricted |
  // not-determined. At any hour: it is a switch on the phone, not a position.
  // → { ok: true }
  "me/location/permission": guardedAction(requireEmployee, async ({ args }, me) =>
    setLocationPermission(me.id, oneOf(args[0], PERMISSIONS, "permission"), bool(args[1]))
  ),

  // Somebody put something in the office's shared shop cart (the app's
  // "Office shopping" web view). The cart is the shop's; this only tells the
  // manager it moved — lib/office-shopping.ts.
  "me/shopping/added": guardedAction(requireEmployee, async (input, me) => {
    const label = shoppingLabel(input.args[0]);
    const { title, message } = shoppingMessage(me.name, label);
    await notifyAdmin({
      type: "SUPPLY_REQUEST",
      title,
      message,
      url: "/admin/requests",
      dedupeKey: shoppingDedupeKey(me.id, label, new Date()),
      employeeId: me.id,
    });
    return { ok: true };
  }),
};

/**
 * The cookies a web view handed over, kept to the fields that go back in.
 *
 * Anything missing a name or a domain is dropped rather than stored: a cookie
 * that cannot be put back is weight in the row and a puzzle on the phone. The
 * cap is there because this comes from a client and a settings row should not
 * be a place to put a megabyte.
 */
function readCookies(raw: unknown): ShopCookie[] {
  if (!Array.isArray(raw)) return [];

  const cookies: ShopCookie[] = [];
  for (const item of raw.slice(0, 100)) {
    if (!item || typeof item !== "object") continue;
    const one = item as Record<string, unknown>;
    const name = typeof one.name === "string" ? one.name.slice(0, 200) : "";
    const domain = typeof one.domain === "string" ? one.domain.slice(0, 200) : "";
    if (!name || !domain) continue;

    cookies.push({
      name,
      value: typeof one.value === "string" ? one.value.slice(0, 4096) : "",
      domain,
      path: typeof one.path === "string" ? one.path.slice(0, 200) : "/",
      expires: typeof one.expires === "number" && Number.isFinite(one.expires) ? one.expires : null,
      secure: one.secure === true,
      httpOnly: one.httpOnly === true,
    });
  }

  return cookies;
}
