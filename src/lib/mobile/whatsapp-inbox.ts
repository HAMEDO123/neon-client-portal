import type { Staff } from "@/lib/admin-guard";
import { RpcError } from "@/lib/mobile/rpc";
import { getTimezone } from "@/lib/settings";
import { activeTransport, checkWhatsAppConnection, getCloudCredentials } from "@/lib/whatsapp";
import {
  getWhatsAppConfig,
  lineStatus,
  sendWhatsAppChatMessage,
  whatsAppChatMessages,
  whatsAppChats,
  type WhatsAppChat,
  type WhatsAppChatMessage,
} from "@/lib/whatsapp/worker";

// The studio's WhatsApp, for the phone app.
//
// The same lib calls the website's WhatsApp tab makes — `whatsAppChats`,
// `whatsAppChatMessages`, `sendWhatsAppChatMessage` — behind the same guard,
// so the app and the portal cannot disagree about who may read the studio's
// messages or answer in them. What this file adds is only what a phone needs
// that a browser did not:
//
//   - **One shape, always.** The chats come from a separate service (the
//     worker), whose rows are passed through here field by field, so an older
//     or newer worker cannot hand the app a row it fails to decode and lose the
//     whole list over one field.
//   - **The worker's refusals keep their words but never its 401.** A 401 on
//     the phone means "you are signed out" and signs the person out; the worker
//     answering 401 means its own key was refused, which is nothing to do with
//     the person holding the phone.
//   - **Replying is the website's route, restated as an action.** There is no
//     server action for it — the website answers from a route handler — so its
//     rules are repeated here exactly: the conversation is read first, a group
//     is refused with a sentence, and whether this is a `reply` or a
//     `notification` is decided from what the account holds, never by the phone.

/** The website's own limit on one reply (api/whatsapp/chats/[chatId]/send). */
export const REPLY_MAX_LENGTH = 4000;

/** The worker's own ceiling on a read (whatsapp-worker/server.mjs MAX_LIMIT). */
const MAX_LIMIT = 200;

/** A worker status the phone can be handed as it is; anything else is "the worker failed". */
export function workerStatus(status: number | undefined): number {
  return status === 400 || status === 404 || status === 409 || status === 422 || status === 429 ? status : 502;
}

/** `?limit=` as the website's routes read it, held to what the worker will answer. */
export function limitFrom(raw: string | null, fallback: number): number {
  const asked = Number(raw);
  if (!Number.isFinite(asked) || asked < 1) return fallback;
  return Math.min(Math.floor(asked), MAX_LIMIT);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function ms(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

export type MobileWhatsAppChat = {
  id: string;
  name: string | null;
  number: string | null;
  isGroup: boolean;
  /** WhatsApp's own count; -1 is "marked unread" on the handset. */
  unreadCount: number;
  archived: boolean;
  pinned: boolean;
  /** Milliseconds, or null. */
  timestamp: number | null;
  lastMessage: {
    body: string;
    fromMe: boolean;
    type: string;
    hasMedia: boolean;
    timestamp: number | null;
  } | null;
};

export type MobileWhatsAppMessage = {
  id: string | null;
  body: string;
  fromMe: boolean;
  author: string | null;
  type: string;
  hasMedia: boolean;
  timestamp: number | null;
};

function chatOf(chat: WhatsAppChat): MobileWhatsAppChat {
  const last = chat.lastMessage;
  return {
    id: text(chat.id),
    name: optText(chat.name),
    number: optText(chat.number),
    isGroup: chat.isGroup === true,
    unreadCount: count(chat.unreadCount),
    archived: chat.archived === true,
    pinned: chat.pinned === true,
    timestamp: ms(chat.timestamp),
    lastMessage: last
      ? {
          body: text(last.body),
          fromMe: last.fromMe === true,
          type: text(last.type) || "chat",
          hasMedia: last.hasMedia === true,
          timestamp: ms(last.timestamp),
        }
      : null,
  };
}

function messageOf(message: WhatsAppChatMessage): MobileWhatsAppMessage {
  return {
    id: optText(message.id),
    body: text(message.body),
    fromMe: message.fromMe === true,
    author: optText(message.author),
    type: text(message.type) || "chat",
    hasMedia: message.hasMedia === true,
    timestamp: ms(message.timestamp),
  };
}

/**
 * The inbox as the website's page draws it: the chats, or the worker's own
 * sentence when they cannot be read — "line is not linked" is the truth, not an
 * empty list — plus the studio's timezone every time on the page is shown in.
 *
 * The line's state comes along without its QR or pairing code: linking the
 * number is the manager's alone, and a code on somebody else's screen is a way
 * to link a different phone as the studio.
 */
export async function readInbox(who: Staff, limit: number) {
  const worker = getWhatsAppConfig();
  const [timeZone, result, line] = await Promise.all([
    getTimezone(),
    whatsAppChats(limit),
    worker ? lineStatus() : Promise.resolve(null),
  ]);

  const error = result.ok ? null : result.error;
  return {
    chats: result.ok ? (result.data.chats ?? []).filter((chat) => typeof chat?.id === "string" && chat.id).map(chatOf) : [],
    error,
    notLinked: error ? /not linked/i.test(error) : false,
    line: line?.ok ? { status: text(line.data.status) || "disconnected", phoneNumber: optText(line.data.phoneNumber) } : null,
    timeZone,
    canManageLine: who.type === "ADMIN",
    limit,
  };
}

/** One conversation, oldest message first. Nothing is marked read on the phone. */
export async function readThread(chatId: string, limit: number) {
  const result = await whatsAppChatMessages(chatId, limit);
  if (!result.ok) throw new RpcError(result.error, workerStatus(result.status));

  return {
    chat: {
      id: optText(result.data.chat?.id),
      name: optText(result.data.chat?.name),
      isGroup: result.data.chat?.isGroup === true,
    },
    messages: (result.data.messages ?? []).map(messageOf),
    limit,
  };
}

/**
 * Answering in one of the studio's conversations — POST
 * /api/whatsapp/chats/[chatId]/send, rule for rule. Queued, not sent: the
 * app shows "Sending" until the account hands the message back.
 */
export async function replyInChat(chatId: string, raw: unknown) {
  const body = typeof raw === "string" ? raw.trim() : "";

  if (!body) throw new RpcError("Write something first.");
  if (body.length > REPLY_MAX_LENGTH) throw new RpcError(`That is longer than ${REPLY_MAX_LENGTH} characters.`);

  const conversation = await whatsAppChatMessages(chatId, 30);
  if (!conversation.ok) throw new RpcError(conversation.error, workerStatus(conversation.status));
  if (conversation.data.chat.isGroup) {
    throw new RpcError("Messages cannot be sent into a WhatsApp group from here — send it to a person instead.");
  }

  const theyHaveWritten = conversation.data.messages.some((message) => !message.fromMe);
  const sent = await sendWhatsAppChatMessage(chatId, body, theyHaveWritten ? "reply" : "notification");
  if (!sent.ok) throw new RpcError(sent.error, workerStatus(sent.status));

  return { queued: true };
}

/**
 * The manager's line settings, as /admin/settings reads them: which transport
 * sends, whether it answers, and the linked number's own state.
 */
export async function readLineSettings() {
  const transport = activeTransport();
  const cloud = getCloudCredentials();
  const worker = getWhatsAppConfig();

  const [connection, line] = await Promise.all([
    transport === "none" ? Promise.resolve(null) : checkWhatsAppConnection(),
    worker ? lineStatus() : Promise.resolve(null),
  ]);

  return {
    transport,
    workerConfigured: Boolean(worker),
    workerUrl: worker && transport === "worker" ? worker.baseUrl : null,
    lineId: worker?.line ?? null,
    cloudPhoneNumberId: cloud?.phoneNumberId ?? null,
    connection: connection
      ? {
          transport: connection.transport,
          ok: connection.ok,
          detail: connection.detail,
          number: connection.number ?? null,
        }
      : null,
    link: line?.ok
      ? {
          status: text(line.data.status) || "disconnected",
          qrDataUrl: optText(line.data.qrDataUrl),
          pairingCode: optText(line.data.pairingCode),
          phoneNumber: optText(line.data.phoneNumber),
          error: optText(line.data.error),
        }
      : null,
  };
}
