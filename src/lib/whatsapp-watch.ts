// Noticing that somebody wrote to the studio's WhatsApp.
//
// The studio asked for two things: that a message arriving on the company
// number is something the whole team hears about, and that the clients' chats
// sit in the same list as the team's own — a row each, in order of who wrote
// last. Both need the same fact — how the number's chats stand — and nothing
// tells us: the worker is asked for the chat list and answers with how things
// stand now. So this compares what stands now with what had already been
// announced, says what is new, and keeps the rows the list draws (`inboxRows`,
// `mergeChatList`) so drawing it never waits on the worker. Pure, and tested, because
// the two ways it can go wrong are both loud: announcing history to the whole
// team the first time it runs, or announcing the same message every minute.
//
// **What counts as news.** The last message of a chat, when the other side
// sent it, it is an actual message, and it is newer than anything announced for
// that chat. One announcement per chat per look: five messages from one client
// inside a minute are one piece of news, and the count beside it says five.
//
// **What does not.** Our own messages. A chat archived on the handset —
// somebody already decided not to be shown it. WhatsApp's own notices (a group
// being renamed, the encryption banner). And anything from before this started
// watching: the first look records where things stand and announces nothing,
// because fifty old conversations landing on every phone at once is exactly
// what would get this switched off on its first day.

/** A chat as the worker lists it — the fields this needs, and no more. */
export type WatchedChat = {
  id: string;
  name: string | null;
  number: string | null;
  isGroup: boolean;
  unreadCount: number;
  archived: boolean;
  timestamp: number | null;
  lastMessage: { body: string; fromMe: boolean; type: string; timestamp: number | null } | null;
};

export type WatchState = {
  /** When watching began. Nothing from before it is ever announced. */
  since: number;
  /** For each chat, the time of the newest incoming message already announced. */
  seen: Record<string, number>;
};

export type Arrival = {
  chatId: string;
  /** Who it is from, as the inbox names them. */
  title: string;
  /** What they wrote, or what kind of thing they sent. */
  preview: string;
  /** When it was sent — part of what makes the announcement said once. */
  at: number;
  /** WhatsApp's own unread count for the chat, when it has one. */
  unread: number;
  isGroup: boolean;
};

/**
 * One client's conversation, as a row in the chat list.
 *
 * Enough to draw the row and open the conversation, and nothing else — no
 * message is kept here beyond the line a list shows.
 */
export type InboxRow = {
  /** WhatsApp's own id for the chat: what the conversation is opened by. */
  id: string;
  title: string;
  preview: string;
  /** When its last message was sent. */
  at: number;
  /** The handset's own unread count; -1 is "marked unread" there. */
  unread: number;
  fromMe: boolean;
  isGroup: boolean;
};

/** How many conversations the chat list carries: the most recently active. */
export const ROWS_KEPT = 40;

/** What the chat list knows about the company number, without asking the worker again. */
export type InboxSummary = {
  checkedAt: number;
  /** Chats with something unread on the handset. */
  unreadChats: number;
  latest: { title: string; preview: string; at: number; fromMe: boolean } | null;
  /** The conversations themselves, newest first — a row each in the chat list. */
  rows: InboxRow[];
};

/** An arrival older than this is recorded and not announced: it is not news any more. */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

/** WhatsApp's own notices, which nobody wrote. */
const NOT_A_MESSAGE = new Set([
  "gp2",
  "e2e_notification",
  "notification_template",
  "notification",
  "protocol",
  "revoked",
  "automated_greeting_message",
  "ciphertext",
]);

const TYPE_WORDS: Record<string, string> = {
  image: "Photo",
  video: "Video",
  audio: "Audio",
  ptt: "Voice note",
  document: "Document",
  sticker: "Sticker",
  location: "Location",
  vcard: "Contact card",
  multi_vcard: "Contact cards",
  revoked: "Message deleted",
  e2e_notification: "Encryption notice",
  notification_template: "Notice",
  notification: "Notice",
  protocol: "Notice",
  gp2: "Group update",
  ciphertext: "Waiting for this message",
  automated_greeting_message: "Greeting",
  call_log: "Call",
};

/** What a message without words actually is, in the reader's terms. */
export function describeWhatsAppType(type: string): string {
  return TYPE_WORDS[type] ?? "Attachment";
}

/** The line under a chat's name: their words, or what they sent. */
export function whatsAppPreview(last: { body: string; type: string } | null): string {
  if (!last) return "No messages yet";
  return last.body.trim() || describeWhatsAppType(last.type);
}

/** Who a chat is with, the way the inbox says it. */
export function chatTitle(chat: Pick<WatchedChat, "name" | "number" | "isGroup">): string {
  const name = chat.name?.trim();
  if (name) return name;
  if (chat.number?.trim()) return `+${chat.number.trim()}`;
  return chat.isGroup ? "A group" : "Unknown number";
}

/** Reads the stored state back. Anything unreadable is "never looked", not a crash. */
export function readWatchState(raw: string | null | undefined): WatchState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<WatchState> | null;
    if (!value || typeof value.since !== "number" || !Number.isFinite(value.since)) return null;

    const seen: Record<string, number> = {};
    for (const [id, at] of Object.entries(value.seen ?? {})) {
      if (typeof at === "number" && Number.isFinite(at)) seen[id] = at;
    }
    return { since: value.since, seen };
  } catch {
    return null;
  }
}

/** Status broadcasts and channels are not conversations with the studio. */
function isConversation(chat: WatchedChat): boolean {
  return !chat.id.endsWith("@broadcast") && !chat.id.endsWith("@newsletter");
}

/**
 * The conversations a chat list shows, newest first.
 *
 * Not the archived ones — somebody put those away on the handset — and not a
 * chat with nothing in it, which has no line to show and no time to sort by.
 * A chat whose last line is one of WhatsApp's own notices still has its row:
 * it is a conversation, and the notice is simply what its last line says.
 */
export function inboxRows(chats: WatchedChat[], limit: number = ROWS_KEPT): InboxRow[] {
  const rows: InboxRow[] = [];

  for (const chat of chats) {
    if (!isConversation(chat) || chat.archived) continue;
    const last = chat.lastMessage;
    const at = last?.timestamp ?? chat.timestamp;
    if (!last || !at) continue;

    rows.push({
      id: chat.id,
      title: chatTitle(chat),
      preview: whatsAppPreview(last),
      at,
      unread: Math.trunc(chat.unreadCount) || 0,
      fromMe: last.fromMe,
      isGroup: chat.isGroup,
    });
  }

  return rows.sort((a, b) => b.at - a.at).slice(0, Math.max(0, limit));
}

/**
 * What has arrived since the last look, and the state to keep for the next one.
 *
 * `state` null is the first look: where things stand is recorded and nothing is
 * announced.
 */
export function look(
  chats: WatchedChat[],
  state: WatchState | null,
  now: number
): { arrivals: Arrival[]; next: WatchState; summary: InboxSummary } {
  const conversations = chats.filter(isConversation);
  const first = state === null;
  const next: WatchState = { since: state?.since ?? now, seen: {} };
  const arrivals: Arrival[] = [];

  for (const chat of conversations) {
    const before = state?.seen[chat.id] ?? 0;
    const last = chat.lastMessage;
    const at = last?.timestamp ?? null;

    // Carried forward for every chat still on the list, so a look that finds
    // nothing new does not forget what it had already said.
    if (before > 0) next.seen[chat.id] = before;

    if (!last || at == null || last.fromMe || NOT_A_MESSAGE.has(last.type)) continue;

    const threshold = Math.max(before, next.since);
    if (at <= threshold) continue;

    // Recorded whether or not it is announced: an old message, or one in a
    // chat somebody archived, must not come up again on every later look.
    next.seen[chat.id] = at;

    if (first || chat.archived || now - at > STALE_AFTER_MS) continue;

    arrivals.push({
      chatId: chat.id,
      title: chatTitle(chat),
      preview: whatsAppPreview(last),
      at,
      unread: Math.max(0, chat.unreadCount),
      isGroup: chat.isGroup,
    });
  }

  // Oldest first, so a phone shows them in the order they were sent.
  arrivals.sort((a, b) => a.at - b.at);

  const open = conversations.filter((chat) => !chat.archived);
  const newest = open
    .filter((chat) => chat.lastMessage && !NOT_A_MESSAGE.has(chat.lastMessage.type))
    .sort((a, b) => (b.lastMessage?.timestamp ?? b.timestamp ?? 0) - (a.lastMessage?.timestamp ?? a.timestamp ?? 0))[0];

  const summary: InboxSummary = {
    checkedAt: now,
    // -1 is "marked unread" on the handset, which is unread too.
    unreadChats: open.filter((chat) => chat.unreadCount !== 0).length,
    latest: newest?.lastMessage
      ? {
          title: chatTitle(newest),
          preview: whatsAppPreview(newest.lastMessage),
          at: newest.lastMessage.timestamp ?? newest.timestamp ?? now,
          fromMe: newest.lastMessage.fromMe,
        }
      : null,
    rows: inboxRows(conversations),
  };

  return { arrivals, next, summary };
}

function readRow(value: unknown): InboxRow | null {
  const row = value as Partial<InboxRow> | null;
  if (!row || typeof row.id !== "string" || !row.id) return null;
  if (typeof row.title !== "string" || typeof row.at !== "number" || !Number.isFinite(row.at)) return null;
  return {
    id: row.id,
    title: row.title,
    preview: typeof row.preview === "string" ? row.preview : "",
    at: row.at,
    unread: typeof row.unread === "number" && Number.isFinite(row.unread) ? Math.trunc(row.unread) : 0,
    fromMe: Boolean(row.fromMe),
    isGroup: Boolean(row.isGroup),
  };
}

/** Reads the stored summary back, or null when there is none worth showing. */
export function readInboxSummary(raw: string | null | undefined): InboxSummary | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<InboxSummary> | null;
    if (!value || typeof value.checkedAt !== "number") return null;
    const latest = value.latest;
    return {
      checkedAt: value.checkedAt,
      unreadChats: typeof value.unreadChats === "number" ? Math.max(0, Math.trunc(value.unreadChats)) : 0,
      latest:
        latest && typeof latest.title === "string" && typeof latest.preview === "string" && typeof latest.at === "number"
          ? { title: latest.title, preview: latest.preview, at: latest.at, fromMe: Boolean(latest.fromMe) }
          : null,
      // A summary stored before rows were kept has none; one unreadable row
      // costs that row and not the list.
      rows: Array.isArray(value.rows) ? value.rows.map(readRow).filter((row): row is InboxRow => row !== null) : [],
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// One list: the team's conversations and the clients'

/** A conversation of the platform's own, as far as ordering it goes. */
type Listed = { pinned: boolean; last: { createdAt: Date } | null };

export type ListEntry<T> = { kind: "chat"; item: T } | { kind: "whatsapp"; row: InboxRow };

/**
 * The chat list with the company number's conversations in it.
 *
 * The studio asked for the clients to be in the same list as the team — a row
 * each, not a door to a second inbox. So the order is the list's own
 * (lib/chat-prefs.ts) with the clients folded into it by the time of their
 * last message:
 *
 *   1. what this viewer pinned, as it already was — a WhatsApp chat cannot be
 *      pinned here, so nothing of WhatsApp's pushes in above a pin;
 *   2. everything with a last message, the team's and the clients' together,
 *      newest first;
 *   3. colleagues nobody has written to yet, last, as they always were.
 *
 * `items` arrive in the list's own order and keep it among themselves.
 */
export function mergeChatList<T extends Listed>(items: T[], rows: InboxRow[]): ListEntry<T>[] {
  const pinned = items.filter((item) => item.pinned);
  const started = items.filter((item) => !item.pinned && item.last);
  const unstarted = items.filter((item) => !item.pinned && !item.last);

  const timed: { entry: ListEntry<T>; at: number; order: number }[] = [
    ...started.map((item, order) => ({ entry: { kind: "chat" as const, item }, at: item.last!.createdAt.getTime(), order })),
    // After the team's on a tie: the same second is not worth reordering for.
    ...rows.map((row, order) => ({ entry: { kind: "whatsapp" as const, row }, at: row.at, order: started.length + order })),
  ];
  timed.sort((a, b) => b.at - a.at || a.order - b.order);

  return [
    ...pinned.map((item) => ({ kind: "chat" as const, item })),
    ...timed.map(({ entry }) => entry),
    ...unstarted.map((item) => ({ kind: "chat" as const, item })),
  ];
}

/** The line under a client's name in the list: "You: …" for what the studio sent. */
export function rowPreview(row: Pick<InboxRow, "preview" | "fromMe">): string {
  return row.fromMe ? `You: ${row.preview}` : row.preview;
}

/** A WhatsApp conversation as the thread screen needs it, from its id alone if need be. */
export function chatFromRow(
  chatId: string,
  row: InboxRow | null | undefined
): { id: string; name: string | null; number: string | null; isGroup: boolean } {
  const isGroup = row?.isGroup ?? chatId.endsWith("@g.us");
  // The part before the @ is a phone number only for an ordinary chat: a
  // group's is its own id and a @lid chat's is not a number anybody dials.
  const digits = chatId.endsWith("@c.us") ? chatId.slice(0, chatId.indexOf("@")) : null;
  return { id: chatId, name: row?.title ?? null, number: digits && /^\d+$/.test(digits) ? digits : null, isGroup };
}

// ---------------------------------------------------------------------------
// Saying it

/**
 * The announcement of one arrival.
 *
 * It names WhatsApp first, because on a lock screen the first thing to know is
 * that this is a client writing to the studio and not a colleague.
 */
export function arrivalCopy(arrival: Arrival): { title: string; message: string } {
  const words = arrival.preview.length > 140 ? `${arrival.preview.slice(0, 137)}…` : arrival.preview;
  return {
    title: `WhatsApp · ${arrival.title}`,
    message: arrival.unread > 1 ? `${words} (${arrival.unread} unread)` : words,
  };
}

/** One per person per message: a look that runs twice, or wakes late, says it once. */
export function arrivalKey(arrival: Arrival, employeeId: string): string {
  return `WHATSAPP:${arrival.chatId}:${arrival.at}:${employeeId}`;
}

/**
 * Where the announcement opens, on each side.
 *
 * Still the WhatsApp tab's address with `?chat=`, which the tab now passes
 * straight on to the conversation in the chat section (`whatsAppChatUrl`). It
 * is kept as the stored link because the phone app reads these paths, and a
 * path it has never seen is one it cannot route.
 */
export function inboxUrl(side: "admin" | "employee", chatId?: string): string {
  const base = side === "admin" ? "/admin/whatsapp" : "/employee/whatsapp";
  return chatId ? `${base}?chat=${encodeURIComponent(chatId)}` : base;
}

/** Where the chat section keeps the company number's conversations, on each side. */
export function whatsAppChatBase(side: "admin" | "employee"): string {
  return side === "admin" ? "/admin/chat/wa" : "/employee/chat/wa";
}

/** One client's conversation, inside the chat section. */
export function whatsAppChatUrl(side: "admin" | "employee", chatId: string): string {
  return `${whatsAppChatBase(side)}/${encodeURIComponent(chatId)}`;
}

/**
 * A chat id out of a URL segment.
 *
 * Decoded only when it still looks encoded, so it does not matter whether the
 * framework already decoded it: an id never contains a `%` of its own.
 */
export function chatIdFromSegment(segment: string): string {
  if (!segment.includes("%")) return segment;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
