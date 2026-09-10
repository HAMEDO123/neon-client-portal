// Showing a message the moment it is sent, and never twice.
//
// Sending used to wait for the server to save the message and redraw the whole
// conversation before anything appeared. Now a copy is put on screen straight
// away, marked as sending — a clock, as in WhatsApp — and swapped for the saved
// message when it comes back. The live stream may deliver the saved message
// first; either way it ends up on screen exactly once, in its place.
//
// Pure, so the rules are tested rather than hoped for.

export type Syncable = {
  id: string;
  kind: string;
  body: string | null;
  status?: "sending" | "failed";
};

const PENDING_PREFIX = "pending-";

export function pendingId() {
  return `${PENDING_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isPending(id: string) {
  return id.startsWith(PENDING_PREFIX);
}

/**
 * The send finished: the pending copy becomes the saved message, where it
 * stands. If the stream already delivered it, the copy simply goes. Null means
 * nothing was saved — an empty message — and the copy goes too.
 */
export function reconcile<T extends { id: string }>(current: T[], tempId: string, saved: T | null): T[] {
  if (!saved || current.some((message) => message.id === saved.id)) {
    return current.filter((message) => message.id !== tempId);
  }
  return current.map((message) => (message.id === tempId ? saved : message));
}

/**
 * Messages from the live stream. Anybody else's are added; one of our own that
 * arrives before its send has finished takes the place of the pending copy
 * rather than appearing beside it.
 */
export function mergeIncoming<T extends Syncable>(current: T[], incoming: T[], isMine: (message: T) => boolean): T[] {
  const next = [...current];

  for (const message of incoming) {
    if (next.some((existing) => existing.id === message.id)) continue;

    const pendingIndex = isMine(message)
      ? next.findIndex(
          (existing) =>
            existing.status === "sending" &&
            existing.kind === message.kind &&
            (existing.body ?? "") === (message.body ?? "")
        )
      : -1;

    if (pendingIndex === -1) next.push(message);
    else next[pendingIndex] = message;
  }

  return next;
}
