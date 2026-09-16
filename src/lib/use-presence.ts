"use client";

import { useSyncExternalStore } from "react";

// Who is here, as the screens read it.
//
// The heartbeat already arrives: every page holds /api/live open, and that
// connection now carries a `people` event. Rather than thread it down through
// half a dozen components, LiveSync publishes it here and anything that needs
// it subscribes — one store for the whole page, read through
// useSyncExternalStore, which is how this codebase reads outside state
// (call-session.ts and use-minute-now.ts do the same) because setting state in
// an effect is what react-hooks/set-state-in-effect refuses.
//
// The map is keyed the way the rest of the platform keys people: "admin" for
// the manager, who has no Employee row, and the employee id otherwise.

export type SeenAt = ReadonlyMap<string, string>;

const EMPTY: SeenAt = new Map();

// Replaced wholesale on every publish, never mutated: useSyncExternalStore
// compares snapshots by identity, so a mutated map would look unchanged.
let current: SeenAt = EMPTY;
const listeners = new Set<() => void>();

/** Called by LiveSync when the heartbeat says who is here. */
export function publishPresence(online: { key: string; at: string }[]) {
  current = new Map(online.map((one) => [one.key, one.at]));
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return current;
}

/** On the server nobody is known to be anywhere, which is the honest starting point. */
function getServerSnapshot(): SeenAt {
  return EMPTY;
}

/**
 * When each person was last seen, or nothing for somebody the platform has not
 * seen. Deliberately not "who is online": the window belongs to presence.ts, so
 * every screen answers that question the same way.
 */
export function usePresence(): SeenAt {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
