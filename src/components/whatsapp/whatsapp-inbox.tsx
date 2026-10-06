"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  MapPin,
  MessageSquare,
  Mic,
  RefreshCw,
  Search,
  Send,
  Users,
  Video,
} from "lucide-react";
import type { WhatsAppChat, WhatsAppChatMessage } from "@/lib/whatsapp/worker";
import { describeWhatsAppType } from "@/lib/whatsapp-watch";
import { cn } from "@/lib/utils";

// The company number's WhatsApp, inside the portal.
//
// A window onto the account the worker already holds, not a copy of it: every
// list and every message below comes from the live session when it is asked
// for, so there is no second inbox to drift. Four things follow from that and
// are deliberate:
//
//   - **It owns the window.** Both shells put this page in their fill mode
//     (`lib/full-window.ts`), so the page itself never scrolls — the list and
//     the conversation scroll inside themselves, the way a messaging app
//     behaves. Everything here is sized from `h-full` for that reason; a fixed
//     height would be a second guess at the shell's.
//   - **Opening a chat changes nothing on the phone.** The worker never calls
//     sendSeen for a read, so looking through the portal leaves the handset's
//     unread badges exactly as they were.
//   - **A closed session is said out loud.** When the number is not linked the
//     tab says so, rather than showing an empty list that reads as "no
//     messages".
//   - **It refreshes itself.** Someone watching this is watching for a reply,
//     and a list that only moves when you press a button is a list you stop
//     trusting.
//
// Replying is the one thing that leaves. It goes through the same queue as
// every other outbound message, so a message is queued rather than sent, and
// this says "Sending" until the account itself hands it back.

const CHAT_REFRESH_MS = 20_000;
const THREAD_REFRESH_MS = 10_000;
/** How soon to look again after queueing something, so it appears promptly. */
const AFTER_SEND_MS = 3_000;

type Pending = { key: number; text: string; at: number };

export function WhatsAppInbox({
  initialChats,
  initialError = null,
  timeZone,
  initialOpenId = null,
}: {
  initialChats: WhatsAppChat[];
  initialError?: string | null;
  timeZone: string;
  /** The chat a notification pointed at (`?chat=`), opened straight away. */
  initialOpenId?: string | null;
}) {
  const [chats, setChats] = useState(initialChats);
  const [error, setError] = useState(initialError);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/whatsapp/chats", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? "The chats could not be read.");
        return;
      }
      setChats(body.chats ?? []);
      setError(null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(refresh, CHAT_REFRESH_MS);
    // Coming back to the tab is the moment the list is most out of date.
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? chats.filter(
        (chat) =>
          (chat.name ?? "").toLowerCase().includes(needle) ||
          (chat.number ?? "").includes(needle) ||
          (chat.lastMessage?.body ?? "").toLowerCase().includes(needle)
      )
    : chats;

  const open = chats.find((chat) => chat.id === openId) ?? null;

  if (error) {
    return <Unavailable message={error} onRetry={refresh} busy={refreshing} />;
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-paper">
      {/* The list. On a phone it gives way to the conversation; on a desk they sit side by side. */}
      <div
        className={cn(
          "flex h-full min-h-0 w-full flex-col border-ink/10 lg:w-80 lg:shrink-0 lg:border-r",
          openId && "hidden lg:flex"
        )}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-ink/10 p-3">
          <div className="relative flex-1">
            <Search size={14} strokeWidth={2} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/35" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search chats"
              dir="auto"
              className="w-full rounded-lg border border-ink/12 bg-white/70 py-2 pl-8 pr-2 text-sm outline-none focus:border-cyan-strong"
            />
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            aria-label="Refresh"
            className="rounded-lg border border-ink/12 bg-white/70 p-2 text-ink/50 transition-colors hover:text-ink"
          >
            <RefreshCw size={14} strokeWidth={2} className={cn(refreshing && "animate-spin")} />
          </button>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {shown.length === 0 && (
            <li className="p-6 text-center text-xs text-ink/45">
              {chats.length === 0 ? "No conversations on this number yet." : "Nothing matches that."}
            </li>
          )}
          {shown.map((chat) => (
            <li key={chat.id}>
              <button
                type="button"
                onClick={() => setOpenId(chat.id)}
                className={cn(
                  "flex w-full items-start gap-2.5 border-b border-ink/[0.06] px-3 py-2.5 text-left transition-colors hover:bg-white/60",
                  openId === chat.id && "bg-white/70"
                )}
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-ink/45">
                  {chat.isGroup ? <Users size={16} strokeWidth={1.75} /> : <MessageSquare size={16} strokeWidth={1.75} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span dir="auto" className="truncate text-sm font-medium text-ink/85">
                      {chat.name || chat.number || "Unknown"}
                    </span>
                    <span className="shrink-0 text-[10px] text-ink/40">{whenShort(chat.timestamp, timeZone)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <span dir="auto" className="min-w-0 flex-1 truncate text-xs text-ink/50">
                      {preview(chat.lastMessage)}
                    </span>
                    {chat.unreadCount > 0 && (
                      <span className="shrink-0 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {chat.unreadCount}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {open ? (
        <Thread key={open.id} chat={open} timeZone={timeZone} onBack={() => setOpenId(null)} />
      ) : (
        <div className="hidden min-w-0 flex-1 items-center justify-center p-8 text-center lg:flex">
          <p className="max-w-xs text-sm text-ink/40">
            Pick a conversation to read it, and to answer as the studio. Opening a chat does not mark it read on the
            phone.
          </p>
        </div>
      )}
    </div>
  );
}

function Thread({
  chat,
  timeZone,
  onBack,
}: {
  chat: WhatsAppChat;
  timeZone: string;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<WhatsAppChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const bottom = useRef<HTMLDivElement>(null);
  const count = useRef(0);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/whatsapp/chats/${encodeURIComponent(chat.id)}/messages`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? "That conversation could not be read.");
        return;
      }
      const arrived: WhatsAppChatMessage[] = body.messages ?? [];
      setMessages(arrived);
      // Anything queued that the account is now handing back has left, and its
      // own bubble replaces ours.
      setPending((waiting) => stillWaiting(waiting, arrived));
      setError(null);
    } catch {
      setError("Could not reach the server.");
    }
  }, [chat.id]);

  // Mounted fresh for each conversation (the parent keys this by chat id), so
  // there is nothing to clear here — only a first read and a poll after it.
  // The first read is handed to a timer rather than called in the effect body:
  // an effect that sets state as it runs cascades a render, and this one is
  // already the thing that arms the poll.
  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(load, THREAD_REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  // Scroll on arrival and when something new lands, but not on every poll —
  // being dragged to the bottom while reading older messages is maddening.
  const total = (messages?.length ?? 0) + pending.length;
  useEffect(() => {
    if (!messages) return;
    if (total !== count.current) {
      count.current = total;
      bottom.current?.scrollIntoView({ block: "end" });
    }
  }, [messages, total]);

  function queued(text: string) {
    setPending((waiting) => [...waiting, { key: Date.now() + waiting.length, text, at: Date.now() }]);
    // Look again shortly, so a message the queue releases quickly shows as
    // itself instead of sitting on "Sending" until the next poll.
    setTimeout(load, AFTER_SEND_MS);
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-ink/10 bg-paper px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg px-2 py-1 text-xs font-medium text-ink/55 hover:bg-white/60 lg:hidden"
        >
          Back
        </button>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/[0.06] text-ink/45">
          {chat.isGroup ? <Users size={15} strokeWidth={1.75} /> : <MessageSquare size={15} strokeWidth={1.75} />}
        </span>
        <div className="min-w-0">
          <p dir="auto" className="truncate text-sm font-semibold text-ink/85">
            {chat.name || chat.number || "Unknown"}
          </p>
          <p className="text-[11px] text-ink/40">{chat.isGroup ? "Group" : chat.number ?? ""}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
        {error && <p className="text-center text-xs font-medium text-pink-strong">{error}</p>}
        {!messages && !error && (
          <p className="flex items-center justify-center gap-2 py-8 text-xs text-ink/40">
            <Loader2 size={14} className="animate-spin" strokeWidth={2} />
            Reading the conversation…
          </p>
        )}
        {messages?.length === 0 && pending.length === 0 && (
          <p className="py-8 text-center text-xs text-ink/40">Nothing in this chat yet.</p>
        )}

        <ul className="flex flex-col gap-1.5">
          {messages?.map((message, index) => (
            <Bubble
              key={message.id ?? index}
              message={message}
              timeZone={timeZone}
              showAuthor={chat.isGroup && !message.fromMe}
            />
          ))}
          {pending.map((waiting) => (
            <li key={waiting.key} className="flex justify-end">
              <div className="max-w-[min(32rem,85%)] rounded-2xl bg-emerald-600/60 px-3 py-2 text-sm text-white">
                <p dir="auto" className="whitespace-pre-wrap break-words">
                  {waiting.text}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-[10px] text-white/80">
                  <Loader2 size={10} className="animate-spin" strokeWidth={2.5} />
                  Sending
                </p>
              </div>
            </li>
          ))}
        </ul>
        <div ref={bottom} />
      </div>

      <Composer chat={chat} onQueued={queued} />
    </div>
  );
}

/**
 * Writing back, as the studio's own number.
 *
 * A group is refused here rather than at the end of a send, because the
 * library will not post into one — saying so after somebody has typed their
 * message is saying it too late.
 */
function Composer({ chat, onQueued }: { chat: WhatsAppChat; onQueued: (text: string) => void }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;

    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/whatsapp/chats/${encodeURIComponent(chat.id)}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: body }),
      });
      const answer = await response.json().catch(() => null);
      if (!response.ok) {
        setError(answer?.error ?? "It could not be sent.");
        return;
      }
      setText("");
      onQueued(body);
      box.current?.focus();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSending(false);
    }
  }

  if (chat.isGroup) {
    return (
      <p className="shrink-0 border-t border-ink/10 bg-paper px-3 py-3 text-center text-[11px] text-ink/45">
        Reading only in a group. WhatsApp is hard on a linked session that posts into groups, so the studio&rsquo;s
        number answers people rather than groups.
      </p>
    );
  }

  return (
    <div className="shrink-0 border-t border-ink/10 bg-paper px-3 py-2.5">
      {error && <p className="mb-1.5 text-xs font-medium text-pink-strong">{error}</p>}
      <div className="flex items-end gap-2">
        <textarea
          ref={box}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, the way it does in WhatsApp; Shift+Enter is a new line.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          rows={1}
          dir="auto"
          placeholder="Write a message"
          className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-ink/12 bg-white/80 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !text.trim()}
          aria-label="Send"
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors",
            text.trim() && !sending ? "bg-emerald-600 text-white" : "bg-ink/8 text-ink/35"
          )}
        >
          {sending ? <Loader2 size={16} className="animate-spin" strokeWidth={2.5} /> : <Send size={16} strokeWidth={2} />}
        </button>
      </div>
      <p className="mt-1 text-[10px] text-ink/35">
        Sent as the studio&rsquo;s WhatsApp number. The queue paces what leaves it, so a message can take a moment.
      </p>
    </div>
  );
}

/**
 * Which queued messages are still queued.
 *
 * A message sent from here comes back from WhatsApp's own store on a later
 * read, and the two must not both be on screen. Matching is by text and
 * consumes one arrival per waiting message, so sending the same words twice
 * shows two bubbles and loses neither; only arrivals from around the time we
 * sent count, or an identical sentence from last week would swallow a new one.
 */
function stillWaiting(waiting: Pending[], arrived: WhatsAppChatMessage[]): Pending[] {
  if (waiting.length === 0) return waiting;

  const left: Pending[] = [];
  const seen = new Map<string, number>();
  for (const message of arrived) {
    if (!message.fromMe) continue;
    const body = message.body.trim();
    seen.set(body, (seen.get(body) ?? 0) + 1);
  }

  for (const one of waiting) {
    const available = seen.get(one.text) ?? 0;
    const recent = arrived.some(
      (message) => message.fromMe && message.body.trim() === one.text && (message.timestamp ?? 0) >= one.at - 120_000
    );
    if (available > 0 && recent) {
      seen.set(one.text, available - 1);
      continue;
    }
    left.push(one);
  }

  return left;
}

function Bubble({
  message,
  timeZone,
  showAuthor,
}: {
  message: WhatsAppChatMessage;
  timeZone: string;
  showAuthor: boolean;
}) {
  return (
    <li className={cn("flex", message.fromMe ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[min(32rem,85%)] rounded-2xl px-3 py-2 text-sm",
          message.fromMe ? "bg-emerald-600 text-white" : "bg-white/75 text-ink/85 ring-1 ring-ink/[0.06]"
        )}
      >
        {showAuthor && message.author && (
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-60">
            {message.author.replace(/@.*$/, "")}
          </p>
        )}

        {message.hasMedia && message.id && <Attachment message={message} />}

        {message.body && (
          <p dir="auto" className="whitespace-pre-wrap break-words">
            {message.body}
          </p>
        )}

        {!message.body && !message.hasMedia && <p className="italic opacity-60">{describeWhatsAppType(message.type)}</p>}

        <p className={cn("mt-0.5 text-[10px]", message.fromMe ? "text-white/70" : "text-ink/40")}>
          {whenShort(message.timestamp, timeZone)}
        </p>
      </div>
    </li>
  );
}

/**
 * A message's attachment, fetched only when it is actually on screen.
 *
 * A photo is shown; anything else is a link, because a spreadsheet drawn as an
 * image is a broken icon and a voice note is not something a thumbnail can
 * say. The download goes through the portal, so the file is never carried in
 * the page.
 */
function Attachment({ message }: { message: WhatsAppChatMessage }) {
  const href = `/api/whatsapp/media/${encodeURIComponent(message.id ?? "")}`;

  if (message.type === "image" || message.type === "sticker") {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="mb-1.5 block overflow-hidden rounded-lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={href} alt="" loading="lazy" className="max-h-64 w-full object-cover" />
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "mb-1.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium",
        message.fromMe ? "bg-white/15" : "bg-ink/[0.05]"
      )}
    >
      {iconFor(message.type)}
      {describeWhatsAppType(message.type)}
    </a>
  );
}

function iconFor(type: string) {
  const size = 14;
  if (type === "video") return <Video size={size} strokeWidth={1.75} />;
  if (type === "audio" || type === "ptt") return <Mic size={size} strokeWidth={1.75} />;
  if (type === "image" || type === "sticker") return <ImageIcon size={size} strokeWidth={1.75} />;
  if (type === "location") return <MapPin size={size} strokeWidth={1.75} />;
  return <FileText size={size} strokeWidth={1.75} />;
}

function preview(last: WhatsAppChat["lastMessage"]): string {
  if (!last) return "No messages yet";
  const body = last.body.trim();
  const text = body || describeWhatsAppType(last.type);
  return last.fromMe ? `You: ${text}` : text;
}

/**
 * A time a person can read at a glance: the clock for today, the date before
 * that. Rendered in the studio's own timezone, so a manager reading from a
 * laptop set to somewhere else sees the same times as the phone.
 */
function whenShort(ms: number | null, timeZone: string): string {
  if (!ms) return "";
  const when = new Date(ms);
  const sameDay =
    new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "short" }).format(when) ===
    new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "short" }).format(new Date());

  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    ...(sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "short" }),
  }).format(when);
}

/**
 * The tab when there is nothing to show it from.
 *
 * Says which of the two it is — no worker configured, or a number nobody has
 * linked — because the fix is different and neither is "no messages".
 */
function Unavailable({ message, onRetry, busy }: { message: string; onRetry: () => void; busy: boolean }) {
  const notLinked = /not linked/i.test(message);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <MessageSquare size={28} strokeWidth={1.5} className="text-ink/25" />
      <p className="text-sm font-semibold text-ink/70">
        {notLinked ? "The studio's number is not linked yet" : "WhatsApp cannot be read right now"}
      </p>
      <p className="max-w-sm text-xs text-ink/50">
        {notLinked
          ? "Link it once from Settings — scan the code with the phone that holds the company number, and the chats appear here."
          : message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 flex items-center gap-1.5 rounded-lg border border-ink/12 bg-white/70 px-3 py-1.5 text-xs font-medium text-ink/70"
      >
        <RefreshCw size={13} strokeWidth={2} className={cn(busy && "animate-spin")} />
        Try again
      </button>
    </div>
  );
}
