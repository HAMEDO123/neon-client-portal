import { requireAdmin, requireWhatsAppAccess } from "@/lib/admin-guard";
import {
  readLinkStatus,
  sendTestWhatsApp,
  startWhatsAppLinking,
  unlinkWhatsApp,
} from "@/lib/actions/whatsapp-actions";
import {
  guarded,
  guardedAction,
  optParam,
  param,
  RpcError,
  str,
  type ActionRegistry,
  type ReadRegistry,
} from "@/lib/mobile/rpc";
import { limitFrom, readInbox, readLineSettings, readThread, replyInChat } from "@/lib/mobile/whatsapp-inbox";
import { inboxSummary } from "@/lib/notifications/whatsapp-events";

// The "whatsapp" area of the phone API. See lib/mobile/rpc.ts: keys are
// "whatsapp/<name>"; every read is guarded(<the website page's guard>, …); an
// action calls the website's own server action, or is guardedAction(…) when it
// calls a lib function directly.
//
// Two guards, as on the website. Reading and answering the studio's
// conversations is `requireWhatsAppAccess` — the manager, or somebody the
// manager has ticked for it (the inbox page, /api/whatsapp/*). The line itself
// — linking and unlinking the number, the transport's health, a free-text test
// message — is `requireAdmin`, as on /admin/settings and in whatsapp-actions.ts.
//
// Attachments are bytes, not JSON, so they have a route of their own:
// GET /api/mobile/whatsapp/media/<messageId>, behind the same guard.

export const reads: ReadRegistry = {
  // The WhatsApp tab: the chats (most recently active first), or the worker's
  // own sentence when they cannot be read. ?limit= as the website's route.
  "whatsapp/inbox": guarded(requireWhatsAppAccess, async (params, who) =>
    readInbox(who, limitFrom(optParam(params, "limit"), 50))
  ),

  // One conversation, oldest first. ?chatId=&limit=. Marks nothing read.
  "whatsapp/messages": guarded(requireWhatsAppAccess, async (params) =>
    readThread(param(params, "chatId"), limitFrom(optParam(params, "limit"), 50))
  ),

  // The company number's conversations as the chat list draws them — a row
  // per client, among the team's own chats: { checkedAt, unreadChats, latest:
  // { title, preview, at, fromMe } | null, rows: [{ id, title, preview, at,
  // unread, fromMe, isGroup }] }, newest first, the forty most recently active
  // and none archived. Null when there is no linked number (draw no rows).
  // `at` is milliseconds; `unread` is the handset's own count (-1 is "marked
  // unread" there). Read from what the minute's look stored
  // (lib/notifications/whatsapp-events.ts), so it answers at once and never
  // waits on the worker — unlike "whatsapp/inbox", which asks it.
  "whatsapp/summary": guarded(requireWhatsAppAccess, async () => inboxSummary()),

  // The manager's line settings: transport, whether it answers, the linked number.
  "whatsapp/line": guarded(requireAdmin, async () => readLineSettings()),

  // The linking panel's poll while a code is on screen — the website's own
  // readLinkStatus, which carries requireAdmin itself as well.
  "whatsapp/link-status": guarded(requireAdmin, async () => readLinkStatus()),
};

export const actions: ActionRegistry = {
  // Answer in a conversation as the studio: args [chatId, text]. Queued, not
  // sent — { queued: true }. The website answers from a route handler, not a
  // server action, so its rules live in lib/mobile/whatsapp-inbox.ts.
  "whatsapp/send": guardedAction(requireWhatsAppAccess, async ({ args }) =>
    replyInChat(str(args[0], "chatId"), args[1])
  ),

  // Start linking the number: form { phone? }. Answers the QR or the pairing
  // code to show (or status "error" with the worker's sentence).
  "whatsapp/link": async ({ form }) => startWhatsAppLinking(form),

  "whatsapp/unlink": async () => {
    const outcome = await unlinkWhatsApp();
    if (!outcome.ok) throw new RpcError(outcome.message);
    return outcome;
  },

  // A one-off message to any number, from Settings: form { phone, text }.
  "whatsapp/test": async ({ form }) => {
    const outcome = await sendTestWhatsApp(form);
    if (!outcome.ok) throw new RpcError(outcome.message);
    return outcome;
  },
};
