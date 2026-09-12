"use client";

import { useSyncExternalStore } from "react";

// The clock the cards count against, ticking once a minute.
//
// Countdowns and deadline bars have to recalculate themselves — an app left
// open overnight must not still say "2 days left" in the morning — but a minute
// is as fine as anything here needs.
//
// Read through useSyncExternalStore rather than set in an effect: the server
// has no clock the phone would agree with, so it renders nothing and the first
// client render fills it in, without the cascading render React warns about.
// One interval serves every card on the screen, and it stops with the last one.

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let snapshot = Date.now();

function subscribe(onChange: () => void) {
  listeners.add(onChange);

  if (!timer) {
    timer = setInterval(() => {
      snapshot = Date.now();
      for (const listener of listeners) listener();
    }, 60_000);
  }

  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** The current minute as a timestamp on the device, and null on the server. */
export function useMinuteNow(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => null
  );
}
