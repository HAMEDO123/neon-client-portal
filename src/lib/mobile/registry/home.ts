import { requireAdmin } from "@/lib/admin-guard";
import { clearAdminAlerts } from "@/lib/actions/admin-alert-actions";
import { applyPerformanceDeductions } from "@/lib/actions/analytics-actions";
import { approveSubmission, rejectSubmission } from "@/lib/actions/submission-actions";
import {
  homeAlerts,
  homeAnalytics,
  homeDay,
  homeOverview,
  homeReviews,
  markHomeAlertRead,
} from "@/lib/mobile/home-reads";
import { homeNow } from "@/lib/mobile/home-now";
import {
  guarded,
  guardedAction,
  optParam,
  RpcError,
  str,
  type ActionRegistry,
  type ReadRegistry,
} from "@/lib/mobile/rpc";

// The "home" area of the phone API: the manager's dashboard, Activity, Reviews
// and Analytics. See lib/mobile/rpc.ts: keys are "home/<name>"; every read is
// guarded(<the website page's guard>, …); an action calls the website's own
// server action, or is guardedAction(…) when it calls a lib function directly.
//
// The four admin pages sit behind the admin layout's session check, and every
// action they call opens with requireAdmin — so requireAdmin is the guard here.

export const reads: ReadRegistry = {
  // The dashboard's figures, the sidebar's waiting counts, and every project
  // (src/app/admin/(dashboard)/page.tsx).
  "home/overview": guarded(requireAdmin, async () => homeOverview()),

  // The dashboard's "The day" section: the team's day board for today.
  "home/day": guarded(requireAdmin, async () => homeDay()),

  // The dashboard's "Right now" strip: what each active employee is on and
  // what is next. Not on the website — an app-only read, still guarded like
  // the rest of the dashboard because it is the same admin-only figures.
  "home/now": guarded(requireAdmin, async () => homeNow()),

  // Activity (src/app/admin/(dashboard)/alerts/page.tsx).
  "home/alerts": guarded(requireAdmin, async () => homeAlerts()),

  // Reviews (src/app/admin/(dashboard)/reviews/page.tsx).
  "home/reviews": guarded(requireAdmin, async () => homeReviews()),

  // Analytics (src/app/admin/(dashboard)/analytics/page.tsx), ?period=YYYY-MM&day=YYYY-MM-DD
  // exactly as the page's own search params.
  "home/analytics": guarded(requireAdmin, async (params) =>
    homeAnalytics(optParam(params, "period"), optParam(params, "day"))
  ),
};

export const actions: ActionRegistry = {
  // "Mark all read" on Activity.
  "home/clearAlerts": async () => clearAdminAlerts(),

  // One alert read, on opening it or swiping it. The website has no action
  // for a single alert, so this is the lib update behind the page's guard.
  "home/markAlertRead": guardedAction(requireAdmin, async ({ args }) => markHomeAlertRead(str(args[0], "id"))),

  // Approve: args [submissionId], form { reviewNote } (optional).
  "home/approveSubmission": async ({ args, form }) => approveSubmission(str(args[0], "submissionId"), form),

  // Send back: args [submissionId], form { reviewNote }. The website refuses a
  // send-back with no reason before it is sent ("Tell them what needs
  // redoing."), because the employee is told the reason; the same rule here.
  "home/rejectSubmission": async ({ args, form }) => {
    const submissionId = str(args[0], "submissionId");
    if (String(form.get("reviewNote") ?? "").trim().length === 0) {
      throw new RpcError("Tell them what needs redoing.");
    }
    return rejectSubmission(submissionId, form);
  },

  // The monthly completion rule for a period: args ["YYYY-MM"]. Running it
  // twice changes nothing (lib/analytics-run.ts).
  "home/applyDeductions": async ({ args }) => {
    const period = str(args[0], "period");
    if (!/^\d{4}-\d{2}$/.test(period)) throw new RpcError("period must be a month, YYYY-MM.");
    return applyPerformanceDeductions(period);
  },
};
