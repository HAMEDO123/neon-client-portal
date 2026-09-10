import { chatPreview } from "@/lib/notifications/types";
import { dayKeyIn } from "@/lib/time";
import { daysBetween } from "@/lib/week";
import type { ChatMessageKind } from "@/generated/prisma/enums";

// Which conversations there are, who may open each, and how they are named
// and summarised. Pure — the database side is chat.ts — so the rule that keeps
// one employee out of another's private chat is pinned by tests.
//
// There is one team conversation everybody is in, and one private conversation
// between the manager and each employee. Employees do not have private
// conversations with each other.

export const TEAM_CHANNEL_KEY = "team";
const DIRECT_PREFIX = "dm:";
/** Every private conversation's channel key, as a SQL LIKE pattern. */
export const DIRECT_KEY_PATTERN = `${DIRECT_PREFIX}%`;

/** The group's picture: the studio's own mark. */
export const GROUP_AVATAR = "/admin-icon-192.png";

export type ChatViewer =
  | { type: "ADMIN"; id: null; name: string }
  | { type: "EMPLOYEE"; id: string; name: string };

export type Conversation = { kind: "team" } | { kind: "direct"; employeeId: string };

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

// Employee ids are cuids: letters and digits only.
const EMPLOYEE_ID = /^[a-z0-9]{8,40}$/i;

/**
 * A conversation from how a URL or a form names it: "team"; for an employee,
 * "manager" for their own private chat; for the manager, the id of the
 * employee the private chat is with. Anything else is nothing.
 */
export function parseConversation(value: string | null | undefined, viewer: ChatViewer): Conversation | null {
  if (!value) return null;
  if (value === "team") return { kind: "team" };
  if (viewer.type === "EMPLOYEE") return value === "manager" ? { kind: "direct", employeeId: viewer.id } : null;
  return EMPLOYEE_ID.test(value) ? { kind: "direct", employeeId: value } : null;
}

/**
 * Whether this viewer may open a conversation. The team: everyone. A private
 * chat: the manager, and the one employee it is with — nobody else, whatever
 * id they send.
 */
export function mayOpen(viewer: ChatViewer, conversation: Conversation) {
  if (conversation.kind === "team") return true;
  return viewer.type === "ADMIN" || viewer.id === conversation.employeeId;
}

/** How a conversation is named in a URL, from this viewer's side of it. */
export function conversationSlug(conversation: Conversation, viewer: ChatViewer) {
  if (conversation.kind === "team") return "team";
  return viewer.type === "EMPLOYEE" ? "manager" : conversation.employeeId;
}

/** Where an employee's phone opens a conversation from a notification. */
export function employeeChatUrl(conversation: Conversation) {
  return conversation.kind === "team" ? "/employee/chat/team" : "/employee/chat/manager";
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
