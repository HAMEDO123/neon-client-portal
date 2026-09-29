import { prisma } from "@/lib/db";
import { groupEmployees } from "@/lib/chat-group-store";
import { memberKeyFor, presenceFor, readMarksFor, typingIn } from "@/lib/presence-store";
import { isOnline } from "@/lib/presence";
import type { ChatViewer, Conversation } from "@/lib/chat-conversations";
import { conversationMemberKeys, othersIn, type ReceiptMember } from "@/lib/mobile/chat-receipt-rules";

// The database side of the phone's ticks (chat-receipt-rules.ts has the rule):
// who is in a conversation, and for each of them how far they have read it and
// when they were last here. Also the whole `people` snapshot the phone's
// stream sends — who is writing, the read markers, and these members — so the
// stream and the registry read answer in one shape.
//
// Not "use server": every export of one of those is callable over the network,
// and these trust their caller to have opened the conversation through
// channelFor already.

/** One person in a conversation: their key, and the name a typing line or "read by" says. */
export type RosterEntry = { key: string; name: string };

/**
 * Everybody in a conversation, the manager included where they are in it.
 * Read once per stream connection: who is in a conversation changes far less
 * often than a connection lives (four minutes).
 */
export async function conversationRoster(conversation: Conversation): Promise<RosterEntry[]> {
  let people: { id: string; name: string }[] = [];
  if (conversation.kind === "team") {
    people = await prisma.employee.findMany({
      where: { active: true, accessRole: "EMPLOYEE" },
      orderBy: { order: "asc" },
      select: { id: true, name: true },
    });
  } else if (conversation.kind === "group") {
    people = await groupEmployees(conversation.groupId);
  } else {
    // A private chat names its people; somebody who has since left keeps
    // their place in it, so their name is read whatever their state.
    const ids = conversation.kind === "direct" ? [conversation.employeeId] : [...conversation.employeeIds];
    people = await prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  }

  const nameOf = new Map(people.map((person) => [person.id, person.name]));
  const ids = people.map((person) => person.id);
  const keys = conversationMemberKeys(conversation, { team: ids, groupMembers: ids });
  return keys.map((key) => ({ key, name: key === "admin" ? "Manager" : (nameOf.get(key) ?? "") }));
}

/**
 * Everybody else in the conversation, each with their read marker for it and
 * their last heartbeat — what the phone turns into one, two or two green ticks.
 */
export async function receiptMembers(
  viewer: ChatViewer,
  roster: readonly RosterEntry[],
  reads: readonly { readerKey: string; lastReadAt: Date }[]
): Promise<ReceiptMember[]> {
  const others = othersIn(
    roster.map((entry) => entry.key),
    memberKeyFor(viewer)
  );
  const seen = await presenceFor(others);
  const readOf = new Map(reads.map((mark) => [mark.readerKey, mark.lastReadAt]));
  const nameOf = new Map(roster.map((entry) => [entry.key, entry.name]));
  const now = Date.now();
  return others.map((key) => ({
    key,
    name: nameOf.get(key) ?? "",
    readAt: readOf.get(key)?.toISOString() ?? null,
    seenAt: seen.get(key)?.toISOString() ?? null,
    online: isOnline(seen.get(key), now),
  }));
}

/**
 * The phone's `people` snapshot: the web stream's own `typing` and `reads`,
 * unchanged, plus `members`. `signature` moves whenever anything in it does —
 * somebody typing, reading, or beating — so a stream sends it only then.
 */
export async function peopleSnapshot(viewer: ChatViewer, roster: readonly RosterEntry[], channelId: string) {
  const typing = await typingIn(channelId);
  const reads = await readMarksFor(channelId);
  const members = await receiptMembers(viewer, roster, reads);
  // Sorted, because the rows come back in no promised order and a signature
  // that moved only because the order did would resend for nothing.
  const signature = [
    typing
      .map((one) => one.memberKey)
      .sort()
      .join(","),
    reads
      .map((mark) => `${mark.readerKey}:${mark.lastReadAt.getTime()}`)
      .sort()
      .join(","),
    members.map((member) => `${member.key}:${member.seenAt ?? ""}:${member.online ? 1 : 0}`).join(","),
  ].join("|");
  return {
    signature,
    snapshot: {
      typing,
      reads: reads.map((mark) => ({ key: mark.readerKey, at: mark.lastReadAt.toISOString() })),
      members,
    },
  };
}
