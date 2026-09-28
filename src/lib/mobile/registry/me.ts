import { requireEmployee } from "@/lib/employee-session";
import { guarded, type ActionRegistry, type ReadRegistry } from "@/lib/mobile/rpc";

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
};

export const actions: ActionRegistry = {};
