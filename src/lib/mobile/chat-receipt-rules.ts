import { isReadBy } from "@/lib/presence";
import type { Conversation } from "@/lib/chat-conversations";

// The phone's WhatsApp ticks: one grey tick when a message is saved, two grey
// when it has reached everybody else in the conversation, two green when
// everybody else has read it. Pure — the database side is chat-receipts.ts —
// so the rule the app draws from is pinned by tests.
//
// Built only from what the platform already records, and never a guess:
// "reached" means the person's app or web page was open at or after the
// moment the message was saved (their ChatPresence heartbeat, which is how the
// message could have got to them at all), and "read" means their ChatRead
// marker for this conversation is at or after it. A read implies it reached
// them, since opening a conversation is being here.
//
// In the team and in a group the ticks turn only when EVERYBODY else has got
// there. The web deliberately draws no read tick in the team, because one pair
// of ticks cannot honestly mean "everybody" when it only knows one person; the
// app can say it honestly because it knows every member's marker, and green
// here means exactly that — all of them. Somebody who has never opened the
// conversation keeps it grey, as they should.

/** How far one of my messages has got. */
export type Delivery = "sent" | "delivered" | "read";

/** Somebody else in a conversation, as the app is told about them. */
export type ReceiptMember = {
  /** "admin" for the manager, the employee id otherwise — ChatRead.readerKey. */
  key: string;
  name: string;
  /** Their read marker for this conversation, or null when they have never opened it. */
  readAt: string | null;
  /** Their last heartbeat anywhere on the platform, or null when never seen. */
  seenAt: string | null;
};

/** Who can be in each kind of conversation, as the database says. */
export type Roster = {
  /** Everybody on the team (active, EMPLOYEE accounts) — the team conversation. */
  team?: readonly string[];
  /** A group's active members — the manager is in every group without a row. */
  groupMembers?: readonly string[];
};

/**
 * Everybody in a conversation, by the key reads and presence are kept under.
 * The manager is "admin" and is in the team, every private chat with the
 * manager and every group — never in a chat between two employees.
 */
export function conversationMemberKeys(conversation: Conversation, roster: Roster = {}): string[] {
  let keys: string[];
  switch (conversation.kind) {
    case "team":
      keys = ["admin", ...(roster.team ?? [])];
      break;
    case "direct":
      keys = ["admin", conversation.employeeId];
      break;
    case "peer":
      keys = [...conversation.employeeIds];
      break;
    case "group":
      keys = ["admin", ...(roster.groupMembers ?? [])];
      break;
  }
  return [...new Set(keys)];
}

/** Everybody in it except the person asking. */
export function othersIn(memberKeys: readonly string[], viewerKey: string) {
  return memberKeys.filter((key) => key !== viewerKey);
}

function reached(createdAt: Date | string, member: Pick<ReceiptMember, "readAt" | "seenAt">) {
  const at = new Date(createdAt).getTime();
  if (member.readAt && new Date(member.readAt).getTime() >= at) return true;
  return member.seenAt ? new Date(member.seenAt).getTime() >= at : false;
}

/**
 * The ticks on a message of mine. With nobody else in the conversation there
 * is nobody for it to reach, so it stays "sent" rather than claiming "read".
 */
export function deliveryOf(
  createdAt: Date | string,
  others: readonly Pick<ReceiptMember, "readAt" | "seenAt">[]
): Delivery {
  if (others.length === 0) return "sent";
  if (others.every((member) => isReadBy(createdAt, member.readAt))) return "read";
  if (others.every((member) => reached(createdAt, member))) return "delivered";
  return "sent";
}
