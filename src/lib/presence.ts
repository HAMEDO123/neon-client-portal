// Who is here, and who is writing.
//
// Pure, and the one place the windows are decided: how long after a heartbeat
// somebody still counts as here, and how long after a keystroke they still
// count as writing. The database side is presence-store.ts.
//
// The rule this module keeps, and the reason every function can return null:
// **not knowing is not the same as being away.** A person the platform has
// never seen gets no line at all rather than "Offline" — the same refusal the
// day board makes when it says an unanswered question is an unanswered
// question, never that somebody did nothing.

/**
 * How long a heartbeat counts for. The page beats every 30 seconds, so this
 * survives one missed beat — a phone that slept for a moment, a tunnel that
 * blinked — without calling somebody away who is sitting right there.
 */
export const ONLINE_WINDOW_MS = 75_000;

/** How long after the last keystroke somebody still reads as writing. */
export const TYPING_WINDOW_MS = 7_000;

/** How often a page writes its heartbeat. Cheap enough to be honest, rare enough not to be a load. */
export const HEARTBEAT_MS = 30_000;

export function isOnline(lastSeenAt: Date | string | null | undefined, now: number) {
  if (!lastSeenAt) return false;
  return now - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS;
}

/**
 * Whether somebody is writing in this conversation. Both halves are required:
 * a stamp with no channel, or a channel with a stale stamp, is not typing.
 */
export function isTyping(
  typingChannelId: string | null | undefined,
  typingAt: Date | string | null | undefined,
  channelId: string,
  now: number
) {
  if (!typingChannelId || !typingAt) return false;
  if (typingChannelId !== channelId) return false;
  return now - new Date(typingAt).getTime() < TYPING_WINDOW_MS;
}

/**
 * The line under somebody's name: "Online" while the heartbeat is fresh, then
 * how long ago they were here — and **null when the platform has never seen
 * them**, so a screen says nothing rather than inventing an absence.
 */
export function lastSeenLabel(lastSeenAt: Date | string | null | undefined, now: number): string | null {
  if (!lastSeenAt) return null;
  if (isOnline(lastSeenAt, now)) return "Online";

  const minutes = Math.floor((now - new Date(lastSeenAt).getTime()) / 60_000);
  if (minutes < 1) return "Last seen just now";
  if (minutes < 60) return `Last seen ${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last seen ${hours} h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "Last seen yesterday";
  if (days < 7) return `Last seen ${days} days ago`;
  return "Last seen a while ago";
}

/**
 * A message counts as read by somebody once they have read the conversation
 * past the moment it was sent. Null `readAt` means they have never opened it,
 * which is not the same as having read nothing since — it is simply unknown.
 */
export function isReadBy(
  messageCreatedAt: Date | string,
  readerLastReadAt: Date | string | null | undefined
) {
  if (!readerLastReadAt) return false;
  return new Date(readerLastReadAt).getTime() >= new Date(messageCreatedAt).getTime();
}
