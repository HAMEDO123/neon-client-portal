import { prisma } from "@/lib/db";
import { MAX_PINNED } from "@/lib/chat-reactions";

// Reactions and pins in the database: giving one and taking it back, lifting a
// message to the top of its conversation, and what the live stream reads to
// send both again. The rules are chat-reactions.ts; the sessions are
// actions/chat-reaction-actions.ts.
//
// Not "use server": every export of one of those is callable over the network,
// and these trust their caller to have resolved the session already.

/**
 * Gives this person's reaction, or takes it back when it was already theirs,
 * and says which it did.
 *
 * Delete first, then create: the unique on (message, person, emoji) is what
 * makes this a toggle, and asking the database whether a row exists before
 * writing leaves a gap two taps can both get through. A create that collides
 * anyway means the other tap won — and the reaction is there, which is what
 * the tap asked for.
 */
export async function toggleReactionRecord(
  messageId: string,
  memberKey: string,
  memberName: string,
  emoji: string
) {
  const removed = await prisma.chatReaction.deleteMany({ where: { messageId, memberKey, emoji } });
  if (removed.count > 0) return "removed" as const;

  try {
    await prisma.chatReaction.create({ data: { messageId, memberKey, memberName, emoji } });
  } catch {
    // Two taps raced and the other one landed first.
  }
  return "added" as const;
}

/**
 * Pins a message or takes the pin off. All three columns move together — a pin
 * with no name behind it would show in the conversation as a claim nobody made.
 */
export async function setPinnedRecord(messageId: string, pin: boolean, memberKey: string, memberName: string) {
  await prisma.chatMessage.update({
    where: { id: messageId },
    data: pin
      ? { pinnedAt: new Date(), pinnedBy: memberKey, pinnedByName: memberName }
      : { pinnedAt: null, pinnedBy: null, pinnedByName: null },
  });
}

/** How many this conversation already holds pinned, for the limit. */
export function countPinned(channelId: string) {
  return prisma.chatMessage.count({ where: { channelId, pinnedAt: { not: null } } });
}

/**
 * The message an action was asked about, with the conversation it lives in —
 * so the action can put it through the same door every other read uses rather
 * than trusting the id it was handed.
 */
export function messageForAction(messageId: string) {
  return prisma.chatMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      channelId: true,
      managerOnly: true,
      pinnedAt: true,
      channel: { select: { key: true } },
    },
  });
}

/**
 * Everything about one conversation's reactions and pins that can change
 * without a new message, folded into one string. A count and a newest moment
 * on each side: a reaction taken back moves the count down, one given moves
 * both, and a pin does the same for its own pair.
 */
export async function reactionSignature(channelId: string) {
  const rows = await prisma.$queryRaw<{ sig: string }[]>`
    SELECT concat_ws('.',
      (SELECT COUNT(*) FROM "ChatReaction" r JOIN "ChatMessage" m ON m.id = r."messageId" WHERE m."channelId" = ${channelId}),
      (SELECT COALESCE(EXTRACT(EPOCH FROM MAX(r."createdAt")) * 1000, 0)::bigint
         FROM "ChatReaction" r JOIN "ChatMessage" m ON m.id = r."messageId" WHERE m."channelId" = ${channelId}),
      (SELECT COUNT(*) FROM "ChatMessage" WHERE "channelId" = ${channelId} AND "pinnedAt" IS NOT NULL),
      (SELECT COALESCE(EXTRACT(EPOCH FROM MAX("pinnedAt")) * 1000, 0)::bigint
         FROM "ChatMessage" WHERE "channelId" = ${channelId} AND "pinnedAt" IS NOT NULL)
    ) AS sig
  `;
  return rows[0]?.sig ?? "";
}

/**
 * The reactions and pins of one conversation as they stand.
 *
 * Scoped to the newest two hundred messages, which is exactly what listMessages
 * loads — a reaction on something nobody can scroll to is not worth sending to
 * every open page every time anything changes.
 */
export async function reactionSnapshot(channelId: string) {
  const recent = await prisma.chatMessage.findMany({
    where: { channelId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true },
  });

  const reactions = recent.length
    ? await prisma.chatReaction.findMany({
        where: { messageId: { in: recent.map((message) => message.id) } },
        orderBy: { createdAt: "asc" },
        select: { messageId: true, memberKey: true, memberName: true, emoji: true },
      })
    : [];

  const pinned = await prisma.chatMessage.findMany({
    where: { channelId, pinnedAt: { not: null } },
    orderBy: { pinnedAt: "desc" },
    take: MAX_PINNED,
    select: {
      id: true,
      kind: true,
      body: true,
      attachmentName: true,
      authorName: true,
      pinnedAt: true,
      pinnedByName: true,
    },
  });

  return { reactions, pinned };
}

export type ChatPinnedView = Awaited<ReturnType<typeof reactionSnapshot>>["pinned"][number];
