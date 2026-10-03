// Whether the page is in the middle of something the live refresh must not
// interrupt.
//
// `LiveSync` calls `router.refresh()` whenever anything in the studio changes,
// which on a busy day is every couple of seconds. A refresh while a server
// action is in flight **cancels it**: the server logs "Connection closed", the
// browser gets a reply it cannot read, and React says *"An unexpected response
// was received from the server"*. Nothing in the log says what was lost.
//
// A click is over in milliseconds and never sees it. An upload takes seconds,
// so it loses that race almost every time — which is why adding a drawing or a
// photo failed while the rest of the admin seemed fine, and why no amount of
// looking at the upload itself found anything wrong with it.
//
// A counter rather than a flag: two uploads can be in flight at once, and the
// first to finish must not declare the page idle.

let depth = 0;
const waiting = new Set<() => void>();

export function beginBusy(): void {
  depth += 1;
}

export function endBusy(): void {
  depth = Math.max(0, depth - 1);
  if (depth === 0) for (const listener of [...waiting]) listener();
}

export function isBusy(): boolean {
  return depth > 0;
}

/** Called when the last thing in flight finishes, so a held-back refresh can run. */
export function onIdle(listener: () => void): () => void {
  waiting.add(listener);
  return () => waiting.delete(listener);
}

/** Runs `work`, holding the refresh off until it is done — however it ends. */
export async function whileBusy<T>(work: () => Promise<T>): Promise<T> {
  beginBusy();
  try {
    return await work();
  } finally {
    endBusy();
  }
}
