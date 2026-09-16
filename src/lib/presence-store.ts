import { prisma } from "@/lib/db";
import { ONLINE_WINDOW_MS, TYPING_WINDOW_MS } from "@/lib/presence";
import type { ChatViewer } from "@/lib/chat-conversations";

// Presence in the database: the heartbeat every open page writes, and the
// note somebody leaves while they are writing a message. The rules — how long
// a beat counts for, how long a keystroke counts for — are presence.ts.
//
// Not "use server": every export of one of those is callable over the network,
// and these trust their caller to have resolved the session already.
//
// One row per person, keyed exactly as ChatRead.readerKey and
// CallParticipant.memberKey are: "admin" for the manager, who has no Employee
// row, and the employee id otherwise.

/** The key a viewer is known by, the same one ChatRead uses. */
export function memberKeyFor(viewer: ChatViewer) {
  return viewer.type === "ADMIN" ? "admin" : viewer.id;
}

/**
 * The heartbeat: this person has the platform open. Deliberately leaves the
 * typing fields alone — a beat arriving mid-message must not say they stopped
 * writing, and a stale typing stamp is ignored when it is read rather than
 * cleaned up here.
 */
export async function beat(memberKey: string) {
  const now = new Date();
  await prisma.chatPresence.upsert({
    where: { memberKey },
    create: { memberKey, lastSeenAt: now },
    update: { lastSeenAt: now },
  });
}

/**
 * Says this person is writing in a conversation, or — with null — that they
 * have stopped. Writing is also being here, so it beats at the same time.
 */
export async function setTyping(memberKey: string, channelId: string | null) {
  const now = new Date();
  const typing = { typingChannelId: channelId, typingAt: channelId ? now : null };
  await prisma.chatPresence.upsert({
    where: { memberKey },
    create: { memberKey, lastSeenAt: now, ...typing },
    update: { lastSeenAt: now, ...typing },
  });
}

/**
 * When each of these people was last seen. People with no row are simply
 * absent from the answer — never returned as a zero, because the platform not
 * having seen somebody is not the same as their being away, and a screen must
 * be able to tell the difference.
 */
export async function presenceFor(memberKeys: string[]) {
  if (memberKeys.length === 0) return new Map<string, Date>();

  const rows = await prisma.chatPresence.findMany({
    where: { memberKey: { in: memberKeys } },
    select: { memberKey: true, lastSeenAt: true },
  });
  return new Map(rows.map((row) => [row.memberKey, row.lastSeenAt]));
}

/**
 * Who is writing in this conversation right now, by name. The window is applied
 * in the query, so a stamp nobody cleared is simply never returned — which is
 * why nothing has to sweep this table.
 */
export async function typingIn(channelId: string, now = new Date()) {
  const rows = await prisma.chatPresence.findMany({
    where: {
      typingChannelId: channelId,
      typingAt: { gte: new Date(now.getTime() - TYPING_WINDOW_MS) },
    },
    select: { memberKey: true },
  });
  if (rows.length === 0) return [];

  // The manager has no Employee row, so their key is named here rather than looked up.
  const ids = rows.map((row) => row.memberKey).filter((key) => key !== "admin");
  const people = ids.length
    ? await prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const nameOf = new Map(people.map((person) => [person.id, person.name]));

  return rows.flatMap((row) => {
    if (row.memberKey === "admin") return [{ memberKey: row.memberKey, name: "Manager" }];
    const name = nameOf.get(row.memberKey);
    // Somebody whose row has gone is not announced as typing under a blank name.
    return name ? [{ memberKey: row.memberKey, name }] : [];
  });
}

/**
 * Everybody the platform has seen inside the window, as keys. The studio is a
 * handful of people, so this is the whole set rather than a per-page question —
 * one small indexed read serves every open page.
 */
export async function onlineNow(now = new Date()) {
  const rows = await prisma.chatPresence.findMany({
    where: { lastSeenAt: { gte: new Date(now.getTime() - ONLINE_WINDOW_MS) } },
    select: { memberKey: true, lastSeenAt: true },
    orderBy: { memberKey: "asc" },
  });
  return rows;
}

/**
 * How far each person has read this conversation — what a read tick is drawn
 * from. Lives here rather than beside recordChatRead because it exists only to
 * answer "has this been read", which is the same question as "is this person
 * here": both are about somebody other than the viewer.
 */
export async function readMarksFor(channelId: string) {
  const rows = await prisma.chatRead.findMany({
    where: { channelId },
    select: { readerKey: true, lastReadAt: true },
  });
  return rows;
}
