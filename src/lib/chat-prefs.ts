// One person's own settings for a conversation — pinned to the top of their
// list, muted, a favourite — and the order the list reads in because of them.
//
// Pure; the database side is chat-pref-store.ts. Nobody but the person who set
// them ever sees them: the manager pinning a chat changes the manager's list,
// not the employee's.

export type ChatPrefs = { pinned: boolean; muted: boolean; favorite: boolean };

export const DEFAULT_PREFS: ChatPrefs = { pinned: false, muted: false, favorite: false };

const FIELDS = ["pinned", "muted", "favorite"] as const;

/**
 * The fields a request asks to change. Only the three names, and only real
 * booleans: a field left out is left as it is, and anything else is refused
 * with a sentence rather than guessed at.
 */
export function readPrefsPatch(value: unknown): Partial<ChatPrefs> {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Settings must be an object.");

  const patch: Partial<ChatPrefs> = {};
  for (const field of FIELDS) {
    const given = (value as Record<string, unknown>)[field];
    if (given === undefined || given === null) continue;
    if (typeof given !== "boolean") throw new Error(`${field} must be true or false.`);
    patch[field] = given;
  }
  return patch;
}

/** What the settings are after a change: the patch over what was there (or the defaults). */
export function mergePrefs(current: Partial<ChatPrefs> | null | undefined, patch: Partial<ChatPrefs>): ChatPrefs {
  return {
    pinned: patch.pinned ?? current?.pinned ?? DEFAULT_PREFS.pinned,
    muted: patch.muted ?? current?.muted ?? DEFAULT_PREFS.muted,
    favorite: patch.favorite ?? current?.favorite ?? DEFAULT_PREFS.favorite,
  };
}

type Orderable = { pinned: boolean; last: { createdAt: Date } | null };

/**
 * The list's order: pinned conversations first, the most recent of them on
 * top, then everything else by its last message, newest first. Conversations
 * nobody has written in yet keep the order they were given, after the rest.
 */
export function orderConversations<T extends Orderable>(items: T[]): T[] {
  // Stable: equal keys keep the order they came in.
  return items
    .map((item, index) => ({ item, index, at: item.last ? item.last.createdAt.getTime() : null }))
    .sort((a, b) => {
      if (a.item.pinned !== b.item.pinned) return a.item.pinned ? -1 : 1;
      if (a.at === b.at) return a.index - b.index;
      if (a.at === null) return 1;
      if (b.at === null) return -1;
      return b.at - a.at;
    })
    .map(({ item }) => item);
}

/** Recipients whose settings do not mute this conversation. `keyOf` gives each one's reader key. */
export function unmuted<T>(recipients: T[], mutedKeys: ReadonlySet<string>, keyOf: (recipient: T) => string) {
  return recipients.filter((recipient) => !mutedKeys.has(keyOf(recipient)));
}
