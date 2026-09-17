import { chatPreview } from "@/lib/notifications/types";
import { dayKeyIn } from "@/lib/time";
import { daysBetween } from "@/lib/week";
import type { ChatMessageKind } from "@/generated/prisma/enums";

// Which conversations there are, who may open each, and how they are named
// and summarised. Pure — the database side is chat.ts — so the rule that keeps
// one employee out of another's private chat is pinned by tests.
//
// There is one team conversation everybody is in, one private conversation
// between the manager and each employee, and one private conversation between
// any two employees. The manager is not in that last kind: what two people on
// the team say to each other is theirs.

export const TEAM_CHANNEL_KEY = "team";
const DIRECT_PREFIX = "dm:";
/** Every private conversation with the manager's channel key, as a SQL LIKE pattern. */
export const DIRECT_KEY_PATTERN = `${DIRECT_PREFIX}%`;
const PEER_PREFIX = "pair:";

/** The group's picture: the studio's own mark. */
export const GROUP_AVATAR = "/admin-icon-192.png";

export type ChatViewer =
  | { type: "ADMIN"; id: null; name: string }
  | { type: "EMPLOYEE"; id: string; name: string };

export type Conversation =
  | { kind: "team" }
  | { kind: "direct"; employeeId: string }
  // Two employees, always in id order, so each pair has exactly one conversation.
  | { kind: "peer"; employeeIds: [string, string] };

export type PeerConversation = Extract<Conversation, { kind: "peer" }>;

/** Which portal is asking, for a browser that holds both sessions. See getChatViewer. */
export type ChatSide = "ADMIN" | "EMPLOYEE";

/** The side a request names, or none — anything else is none. */
export function chatSide(value: string | null | undefined): ChatSide | undefined {
  return value === "ADMIN" || value === "EMPLOYEE" ? value : undefined;
}

/** The channel key of the private conversation between the manager and one employee. */
export function directChannelKey(employeeId: string) {
  return `${DIRECT_PREFIX}${employeeId}`;
}

/** The conversation between two employees, whichever of them names it. */
export function peerConversation(a: string, b: string): PeerConversation {
  const [first, second] = [a, b].sort();
  return { kind: "peer", employeeIds: [first, second] };
}

/** The channel key of the private conversation between two employees: the same from either side. */
export function peerChannelKey(a: string, b: string) {
  const [first, second] = peerConversation(a, b).employeeIds;
  return `${PEER_PREFIX}${first}:${second}`;
}

/**
 * Every conversation one employee has with a colleague, as two SQL LIKE
 * patterns: one for each place their id can sit in the key. Ids are letters and
 * digits only, so neither pattern can match somebody else's conversation.
 */
export function peerKeyPatterns(employeeId: string): [string, string] {
  return [`${PEER_PREFIX}${employeeId}:%`, `${PEER_PREFIX}%:${employeeId}`];
}

/** The other person in a conversation between two employees. */
export function otherPeer(conversation: PeerConversation, employeeId: string) {
  const [first, second] = conversation.employeeIds;
  return first === employeeId ? second : first;
}

/** The conversation behind a channel key, or null for a key that names none. */
export function conversationFromKey(key: string): Conversation | null {
  if (key === TEAM_CHANNEL_KEY) return { kind: "team" };

  if (key.startsWith(DIRECT_PREFIX)) {
    const id = key.slice(DIRECT_PREFIX.length);
    return EMPLOYEE_ID.test(id) ? { kind: "direct", employeeId: id } : null;
  }

  if (key.startsWith(PEER_PREFIX)) {
    const ids = key.slice(PEER_PREFIX.length).split(":");
    const [first, second] = ids;
    const valid = ids.length === 2 && EMPLOYEE_ID.test(first) && EMPLOYEE_ID.test(second) && first !== second;
    return valid ? peerConversation(first, second) : null;
  }

  return null;
}

// Employee ids are cuids: letters and digits only.
const EMPLOYEE_ID = /^[a-z0-9]{8,40}$/i;

/**
 * A conversation from how a URL or a form names it: "team"; for an employee,
 * "manager" for their own private chat and a colleague's id for their chat with
 * that colleague; for the manager, the id of the employee the private chat is
 * with. Anything else is nothing.
 */
export function parseConversation(value: string | null | undefined, viewer: ChatViewer): Conversation | null {
  if (!value) return null;
  if (value === "team") return { kind: "team" };
  if (viewer.type === "EMPLOYEE") {
    if (value === "manager") return { kind: "direct", employeeId: viewer.id };
    // Every id an employee can name is a conversation they are in; never one with themselves.
    return EMPLOYEE_ID.test(value) && value !== viewer.id ? peerConversation(viewer.id, value) : null;
  }
  return EMPLOYEE_ID.test(value) ? { kind: "direct", employeeId: value } : null;
}

/**
 * Whether this viewer may open a conversation. The team: everyone. A private
 * chat with the manager: the manager, and the one employee it is with. A chat
 * between two employees: those two — not the manager, and nobody else, whatever
 * ids they send.
 */
export function mayOpen(viewer: ChatViewer, conversation: Conversation) {
  if (conversation.kind === "team") return true;
  if (conversation.kind === "direct") return viewer.type === "ADMIN" || viewer.id === conversation.employeeId;

  const [first, second] = conversation.employeeIds;
  return viewer.type === "EMPLOYEE" && first !== second && (viewer.id === first || viewer.id === second);
}

/** How a conversation is named in a URL, from this viewer's side of it. */
export function conversationSlug(conversation: Conversation, viewer: ChatViewer) {
  if (conversation.kind === "team") return "team";
  if (conversation.kind === "direct") return viewer.type === "EMPLOYEE" ? "manager" : conversation.employeeId;
  return otherPeer(conversation, viewer.id ?? "");
}

/** Where one employee's phone opens a conversation from a notification: their side of it. */
export function employeeChatUrl(conversation: Conversation, recipientId: string) {
  if (conversation.kind === "team") return "/employee/chat/team";
  if (conversation.kind === "direct") return "/employee/chat/manager";
  return `/employee/chat/${otherPeer(conversation, recipientId)}`;
}

/**
 * Where the manager's phone opens a conversation from a notification.
 *
 * The mirror of employeeChatUrl, and the reason it exists: the manager cannot
 * sign in to the employee portal at all — employee-auth refuses any non-EMPLOYEE
 * account — so a notification carrying an /employee link would open a page that
 * turns them away. A chat between two employees is not theirs either (mayOpen
 * refuses it), so that gives the list rather than a conversation they will be
 * refused; nothing addressed to them should reach it.
 */
export function adminChatUrl(conversation: Conversation) {
  if (conversation.kind === "team") return "/admin/chat/team";
  if (conversation.kind === "direct") return `/admin/chat/${conversation.employeeId}`;
  return "/admin/chat";
}

/** An open conversation, which keeps its own live connection, rather than the list of them. */
export function isConversationPath(pathname: string) {
  return /\/chat\/[^/]+\/?$/.test(pathname);
}

/**
 * The time beside a conversation in the list, the way WhatsApp writes it: the
 * time today, "Yesterday", the weekday within the week, the date before that.
 * Days are the company's, not the server's.
 */
export function listTime(at: Date, now: Date, timeZone: string) {
  const gap = daysBetween(dayKeyIn(timeZone, at), dayKeyIn(timeZone, now));
  if (gap <= 0) {
    return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(at);
  }
  if (gap === 1) return "Yesterday";
  if (gap < 7) return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(at);
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" }).format(at);
}

export type LastMessage = {
  kind: ChatMessageKind;
  body: string | null;
  durationSeconds: number | null;
  attachmentName: string | null;
  authorName: string;
  mine: boolean;
  createdAt: Date;
};

/**
 * The last message's line under a conversation's name: "You: …" for your own,
 * "Wael: …" in the group, and the message alone in a private chat, where who
 * sent it goes without saying.
 */
export function previewLine(last: LastMessage | null, isGroup: boolean) {
  if (!last) return null;
  const text = chatPreview(last.kind, last.body, last.durationSeconds, last.attachmentName);
  if (last.mine) return `You: ${text}`;
  return isGroup ? `${last.authorName}: ${text}` : text;
}
