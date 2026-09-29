import { ONLINE_WINDOW_MS, isReadBy } from "@/lib/presence";
import type { Conversation } from "@/lib/chat-conversations";

// The phone's WhatsApp ticks: one grey tick when a message is saved, two grey
// when it has reached everybody else in the conversation, two green when
// everybody else has read it. Pure — the database side is chat-receipts.ts —
// so the rule the app draws from is pinned by tests.
//
// Built only from what the platform already records, and never a guess:
// "reached" means the person's app or web page was connected at the moment
// the message was saved or after it — by the platform's own meaning of
// connected, the window that draws their green dot (lib/presence.ts): their
// last heartbeat is after the message, or close enough before it that they
// counted as online when it was sent. "Read" means their ChatRead marker for
// this conversation is at or after it. A read implies it reached them, since
// opening a conversation is being here.
//
// Both only ever move forward (a heartbeat and a read marker are only ever
// replaced by later ones), so a message's ticks never go back.
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
  /** Here right now, by the green dot's own window — what the app's header says. */
  online: boolean;
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

/**
 * Connected when the message was saved, or since. A beat comes only every 30
 * seconds, so "a beat after it" alone would keep a message to somebody sitting
 * in front of the app on one tick for up to half a minute; the online window
 * is exactly how long after a beat the platform still calls them here.
 */
function reached(createdAt: Date | string, member: Pick<ReceiptMember, "readAt" | "seenAt">) {
  const at = new Date(createdAt).getTime();
  if (member.readAt && new Date(member.readAt).getTime() >= at) return true;
  return member.seenAt ? new Date(member.seenAt).getTime() >= at - ONLINE_WINDOW_MS : false;
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
