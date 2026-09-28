import type { ActionRegistry, ReadRegistry } from "@/lib/mobile/rpc";

// The "home" area of the phone API. See lib/mobile/rpc.ts: keys are
// "home/<name>"; every read is guarded(<the website page's guard>, …); an action
// calls the website's own server action, or is guardedAction(…) when it calls
// a lib function directly.

export const reads: ReadRegistry = {};

export const actions: ActionRegistry = {};
