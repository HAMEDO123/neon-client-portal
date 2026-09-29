import { prisma } from "@/lib/db";
import { DEFAULT_PREFS, mergePrefs, type ChatPrefs } from "@/lib/chat-prefs";

// One person's settings for their conversations, in the database. The rules
// are chat-prefs.ts. Keyed like ChatRead: "admin" for the manager, the
// employee id otherwise.
//
// Not "use server": every export of one of those is callable over the network,
// and these trust their caller to have opened the channel through channelFor.

const prefsSelect = { channelId: true, pinned: true, muted: true, favorite: true } as const;

/** This reader's settings for each of these channels; a channel with none set reads as the defaults. */
export async function prefsFor(readerKey: string, channelIds: string[]) {
  const map = new Map<string, ChatPrefs>();
  if (channelIds.length === 0) return map;
  const rows = await prisma.chatPref.findMany({
    where: { readerKey, channelId: { in: channelIds } },
    select: prefsSelect,
  });
  for (const row of rows) map.set(row.channelId, { pinned: row.pinned, muted: row.muted, favorite: row.favorite });
  return map;
}

/** Changes this reader's settings for one channel and says what they are now. */
export async function setPrefs(readerKey: string, channelId: string, patch: Partial<ChatPrefs>): Promise<ChatPrefs> {
  const current = await prisma.chatPref.findUnique({
    where: { channelId_readerKey: { channelId, readerKey } },
    select: prefsSelect,
  });
  const next = mergePrefs(current ?? DEFAULT_PREFS, patch);
  const saved = await prisma.chatPref.upsert({
    where: { channelId_readerKey: { channelId, readerKey } },
    create: { channelId, readerKey, ...next },
    update: next,
    select: prefsSelect,
  });
  return { pinned: saved.pinned, muted: saved.muted, favorite: saved.favorite };
}

/** Which of these readers have muted this channel. */
export async function mutedReaders(channelId: string, readerKeys: string[]) {
  if (readerKeys.length === 0) return new Set<string>();
  const rows = await prisma.chatPref.findMany({
    where: { channelId, readerKey: { in: readerKeys }, muted: true },
    select: { readerKey: true },
  });
  return new Set(rows.map((row) => row.readerKey));
}
