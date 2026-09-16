"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Bot,
  CalendarClock,
  Camera,
  CheckCheck,
  ChevronLeft,
  CircleAlert,
  ClipboardList,
  Clock,
  FileText,
  Mic,
  Paperclip,
  Phone,
  PhoneMissed,
  Pin,
  Plus,
  Search,
  Send,
  SmilePlus,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { deleteChatMessage, sendChatMessage } from "@/lib/actions/chat-actions";
import { reactToMessage, setMessagePinned } from "@/lib/actions/chat-reaction-actions";
import { createChatTask } from "@/lib/actions/chat-task-actions";
import { createChatMeeting } from "@/lib/actions/chat-meeting-actions";
import { ChatHeader } from "@/components/chat/chat-header";
import { CallButtons } from "@/components/calls/call-buttons";
import { PersonAvatar } from "@/components/chat/person-avatar";
import { TaskCard } from "@/components/chat/task-card";
import { TaskSheet, type TaskSetup } from "@/components/chat/task-sheet";
import { MeetingCard } from "@/components/chat/meeting-card";
import { MeetingSheet, type MeetingSetup } from "@/components/chat/meeting-sheet";
import { slashMeeting } from "@/lib/chat-meetings";
import { QuickReplies } from "@/components/chat/studio/quick-replies";
import { shrinkPhoto } from "@/lib/client-image";
import { mergeIncoming, pendingId, reconcile } from "@/lib/chat-sync";
import { usePresence } from "@/lib/use-presence";
import { isReadBy, lastSeenLabel } from "@/lib/presence";
import { REACTIONS, tally, type ReactionRow } from "@/lib/chat-reactions";
import { useMinuteNow } from "@/lib/use-minute-now";
import { slashTask } from "@/lib/chat-tasks";
import { playCue } from "@/lib/sound-cues";
import {
  SLIDE_TO_CANCEL_PX,
  audioExtension,
  baseAudioType,
  formatDuration,
  pickAudioType,
  recordingOutcome,
} from "@/lib/voice";
import type { ChatMessageView } from "@/lib/chat";
import type { ChatViewer } from "@/lib/chat-conversations";
import type { ChatTaskView } from "@/lib/chat-task-store";
import type { ChatMeetingView } from "@/lib/chat-meeting-store";
import { cn } from "@/lib/utils";

// A conversation — the team's, or a private one between two people — laid out
// the way a messaging app is: a scrolling column of bubbles, your own on the
// right, everyone else's on the left (in the group with their name above, in
// their own colour), and a composer pinned to the bottom.
//
// Two looks, one conversation. "phone" is the employees' portal, WhatsApp-like
// and edge to edge. "studio" is the manager's desk: the warm palette, a face
// beside every message, a line of quick replies over the composer and a search
// through what was said — the same messages, the same stream, the same rules.
//
// Messages arrive over an event stream, so one person sending is visible to
// everyone else without a refresh. So do the task cards: the same stream sends
// them again whenever somebody's part moves, a photo arrives or a comment is
// written, none of which is a new message.

type Variant = "phone" | "studio";

// A message on screen: saved, or one of ours still on its way.
type Message = ChatMessageView & { status?: "sending" | "failed" };

/** What the composer hands over to send. */
type Draft =
  | { kind: "TEXT"; body: string; projectId: string }
  | { kind: "IMAGE"; file: File; body: string; projectId: string }
  | { kind: "FILE"; file: File; body: string; projectId: string }
  | { kind: "VOICE"; blob: Blob; fileName: string; durationSeconds: number; projectId: string };

/** The cards as the stream last described them: which exist, the newest in full, and when that was. */
type LiveTasks = { at: number; ids: Set<string>; byId: Map<string, ChatTaskView> };

/** The same, for meeting cards, which change when somebody says whether they are coming. */
type LiveMeetings = { at: number; ids: Set<string>; byId: Map<string, ChatMeetingView> };

/** One message lifted to the top of the conversation, as the stream describes it. */
type PinnedView = {
  id: string;
  kind: Message["kind"];
  body: string | null;
  attachmentName: string | null;
  authorName: string;
  pinnedAt: string;
  pinnedByName: string | null;
};

/**
 * Reactions and pins as the stream last described them. Both are changes to
 * messages that already exist, so they arrive whole rather than as news — and
 * once a snapshot has arrived it is the truth, including for a message whose
 * only reaction has just been taken back.
 */
type LiveReactions = { byMessage: Map<string, ReactionRow[]>; pinned: PinnedView[] };

const NAME_COLOURS = [
  "text-cyan-strong",
  "text-purple-strong",
  "text-pink-strong",
  "text-orange-strong",
  "text-emerald-700",
];

/** The same five colours as faces, for the picture beside a message. */
const FACE_COLOURS = ["cyan", "purple", "pink", "orange", "ink"];

function hashOf(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash;
}

/** Same person, same colour, every time — from the name itself. */
function nameColour(name: string) {
  return NAME_COLOURS[hashOf(name) % NAME_COLOURS.length];
}

function faceColour(name: string) {
  return FACE_COLOURS[hashOf(name) % FACE_COLOURS.length];
}

function timeLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(date);
}

function dayLabel(date: Date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(date, today)) return "Today";
  if (same(date, yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short" }).format(date);
}

export function ChatRoom({
  initialMessages,
  viewerType,
  viewerId,
  viewerName,
  canDeleteAny,
  projects,
  conversation,
  header,
  showNames = true,
  emptyText,
  timeZone,
  initialNow,
  taskSetup = null,
  meetingSetup = null,
  focusTaskId = null,
  focusMeetingId = null,
  variant = "phone",
}: {
  initialMessages: Message[];
  viewerType: "ADMIN" | "EMPLOYEE";
  viewerId: string | null;
  viewerName: string;
  canDeleteAny: boolean;
  projects: { id: string; name: string }[];
  /** Which conversation, as its URL names it: "team", or a private chat. */
  conversation: string;
  /** The WhatsApp-style header on top: the group's, or the person's. */
  header?: { name: string; subtitle: string; avatar?: string; backHref?: string };
  /** A private chat has two people in it, so its bubbles need no names. */
  showNames?: boolean;
  emptyText?: string;
  /** The company's timezone, which a card's due moment is written in. */
  timeZone: string;
  /** The server's clock when the page was drawn, until the device's own takes over. */
  initialNow: number;
  /** Present only where this viewer may hand out tasks: who to, and the due moment to start from. */
  taskSetup?: TaskSetup | null;
  /** Present only where this viewer may set meetings: who can be asked, and when one would start. */
  meetingSetup?: MeetingSetup | null;
  /** A card to scroll to and point out, when a notification or the Tasks list opened the chat for it. */
  focusTaskId?: string | null;
  /** The same, for a meeting card a notification opened the chat for. */
  focusMeetingId?: string | null;
  /** "phone" is the employees' portal; "studio" is the manager's three-column desk. */
  variant?: Variant;
}) {
  const studio = variant === "studio";

  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [liveTasks, setLiveTasks] = useState<LiveTasks | null>(null);
  const [liveMeetings, setLiveMeetings] = useState<LiveMeetings | null>(null);
  // Who is writing in this conversation, and how far each person has read it.
  const [people, setPeople] = useState<{ typing: { memberKey: string; name: string }[]; reads: Record<string, string> }>({
    typing: [],
    reads: {},
  });
  // What people gave each message, and what is pinned. Null until the stream's
  // first snapshot lands — until then the messages carry their own, from the
  // page's first draw.
  const [liveReactions, setLiveReactions] = useState<LiveReactions | null>(null);
  const [sheet, setSheet] = useState<{ key: number; title: string } | null>(null);
  const [meetingSheet, setMeetingSheet] = useState<{ key: number; title: string } | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  const newest = messages.at(-1)?.createdAt;

  const viewer: ChatViewer = useMemo(
    () =>
      viewerType === "ADMIN"
        ? { type: "ADMIN", id: null, name: viewerName }
        : { type: "EMPLOYEE", id: viewerId ?? "", name: viewerName },
    [viewerType, viewerId, viewerName]
  );

  const isMine = useCallback(
    (message: Pick<Message, "authorType" | "authorId">) =>
      message.authorType === viewerType && (viewerType === "ADMIN" || message.authorId === viewerId),
    [viewerType, viewerId]
  );

  // How this viewer is keyed everywhere else in the platform.
  const myKey = viewerType === "ADMIN" ? "admin" : (viewerId ?? "");

  // In a private chat the conversation is named by the other person — and
  // "manager" is how an employee names the one person with no employee row.
  const otherKey = showNames ? null : conversation === "manager" ? "admin" : conversation;

  // The one shared clock, ticking each minute: "Last seen 2 min ago" has to age
  // on its own, and a clock set in an effect is what use-minute-now exists to
  // avoid.
  const now = useMinuteNow() ?? initialNow;
  const seenAt = usePresence();
  // Said only where it means one person. In the group it would be a line about
  // five people at once, which is a different thing and not this one.
  const status = otherKey ? lastSeenLabel(seenAt.get(otherKey), now) : null;

  // --- live updates --------------------------------------------------------
  useEffect(() => {
    const since = newest ? new Date(newest).toISOString() : new Date().toISOString();
    const source = new EventSource(
      `/api/chat/stream?as=${viewerType}&with=${encodeURIComponent(conversation)}&since=${encodeURIComponent(since)}`
    );

    source.addEventListener("messages", (event) => {
      const incoming = JSON.parse((event as MessageEvent).data) as (Omit<Message, "createdAt"> & {
        createdAt: string;
      })[];

      const arrived = incoming.map(
        (message) => ({ ...message, createdAt: new Date(message.createdAt) }) as Message
      );
      // Our own message may come back over the stream before its send has
      // finished; it takes the place of the pending copy instead of doubling.
      setMessages((current) => mergeIncoming(current, arrived, isMine));

      // Somebody else's message sounds the moment it lands; the heartbeat's
      // check then finds it already heard.
      const fromOthers = arrived.filter((message) => !isMine(message));
      if (fromOthers.length > 0) {
        playCue("message", Math.max(...fromOthers.map((message) => message.createdAt.getTime())));
      }
    });

    source.addEventListener("tasks", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { at: number; ids: string[]; tasks: ChatTaskView[] };
      setLiveTasks({ at: data.at, ids: new Set(data.ids), byId: new Map(data.tasks.map((task) => [task.id, task])) });
    });

    source.addEventListener("people", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as {
        typing: { memberKey: string; name: string }[];
        reads: { key: string; at: string }[];
      };
      setPeople({
        // Never announce yourself as typing to yourself.
        typing: data.typing.filter((one) => one.memberKey !== myKey),
        reads: Object.fromEntries(data.reads.map((mark) => [mark.key, mark.at])),
      });
    });

    source.addEventListener("meetings", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { at: number; ids: string[]; meetings: ChatMeetingView[] };
      setLiveMeetings({
        at: data.at,
        ids: new Set(data.ids),
        byId: new Map(data.meetings.map((meeting) => [meeting.id, meeting])),
      });
    });

    source.addEventListener("reactions", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as {
        reactions: (ReactionRow & { messageId: string })[];
        pinned: PinnedView[];
      };

      const byMessage = new Map<string, ReactionRow[]>();
      for (const one of data.reactions) {
        const rows = byMessage.get(one.messageId);
        if (rows) rows.push(one);
        else byMessage.set(one.messageId, [one]);
      }
      setLiveReactions({ byMessage, pinned: data.pinned });
    });

    // The browser reconnects on its own; the next connection carries the
    // cursor from whatever this one delivered.
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A task message whose card has gone — deleted by the manager — leaves the
  // conversation. One created after the stream's last look is simply newer
  // than it, not gone.
  const present = useMemo(
    () =>
      messages.filter((message) => {
        if (message.kind === "TASK") {
          if (!message.task) return false;
          if (!liveTasks || liveTasks.ids.has(message.task.id)) return true;
          return new Date(message.task.createdAt).getTime() > liveTasks.at;
        }
        // A meeting called off leaves the conversation the same way.
        if (message.kind === "MEETING") {
          if (!message.meeting) return false;
          if (!liveMeetings || liveMeetings.ids.has(message.meeting.id)) return true;
          return new Date(message.meeting.createdAt).getTime() > liveMeetings.at;
        }
        return true;
      }),
    [messages, liveTasks, liveMeetings]
  );

  // Searching narrows what is on screen to the messages that carry the words —
  // the conversation itself is untouched, and clearing brings all of it back.
  const needle = search?.trim().toLowerCase() ?? "";
  const visible = useMemo(() => {
    if (!needle) return present;
    return present.filter((message) =>
      `${message.body ?? ""} ${message.authorName} ${message.attachmentName ?? ""}`.toLowerCase().includes(needle)
    );
  }, [present, needle]);

  // --- scrolling -----------------------------------------------------------
  // Jump to the newest message, unless the reader has scrolled up to read
  // something older — then leave them where they are.
  useEffect(() => {
    if (pinnedToBottom.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // When the keyboard comes up the list gets shorter from the bottom. Somebody
  // who was reading the latest message should still be looking at it, just
  // above the keyboard, the way a messaging app keeps the last bubble in view.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (pinnedToBottom.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Opened for one card: bring it to the middle of the screen and point it out.
  useEffect(() => {
    if (!focusTaskId) return;
    const card = document.getElementById(`task-${focusTaskId}`);
    if (!card) return;

    pinnedToBottom.current = false;
    card.scrollIntoView({ block: "center" });
    card.classList.add("task-flash");
    const timer = setTimeout(() => card.classList.remove("task-flash"), 2600);
    return () => clearTimeout(timer);
  }, [focusTaskId]);

  // The same, for a meeting a reminder opened the chat for.
  useEffect(() => {
    if (!focusMeetingId) return;
    const card = document.getElementById(`meeting-${focusMeetingId}`);
    if (!card) return;

    pinnedToBottom.current = false;
    card.scrollIntoView({ block: "center" });
    card.classList.add("task-flash");
    const timer = setTimeout(() => card.classList.remove("task-flash"), 2600);
    return () => clearTimeout(timer);
  }, [focusMeetingId]);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  // --- sending -------------------------------------------------------------
  // The message is on screen the moment it is sent, marked with a clock, the
  // way WhatsApp shows one until the tick. Photos are shrunk on the phone and
  // uploaded behind it; the saved message replaces the copy when it is back.
  const sendDraft = useCallback(
    async (draft: Draft) => {
      const tempId = pendingId();
      const preview =
        draft.kind === "IMAGE" ? URL.createObjectURL(draft.file) : draft.kind === "VOICE" ? URL.createObjectURL(draft.blob) : null;

      const pending: Message = {
        id: tempId,
        authorType: viewerType,
        authorId: viewerType === "EMPLOYEE" ? viewerId : null,
        authorName: "",
        kind: draft.kind,
        body: draft.kind === "VOICE" ? null : draft.body || null,
        attachmentUrl: preview,
        attachmentName:
          draft.kind === "IMAGE" || draft.kind === "FILE" ? draft.file.name : draft.kind === "VOICE" ? draft.fileName : null,
        attachmentType: null,
        attachmentSize: null,
        durationSeconds: draft.kind === "VOICE" ? draft.durationSeconds : null,
        managerOnly: false,
        createdAt: new Date(),
        project: projects.find((project) => project.id === draft.projectId) ?? null,
        task: null,
        call: null,
        meeting: null,
        // Nobody has pinned a message that is still on its way.
        pinnedAt: null,
        pinnedByName: null,
        status: "sending",
      };

      pinnedToBottom.current = true;
      setMessages((current) => [...current, pending]);

      const formData = new FormData();
      formData.set("conversation", conversation);
      formData.set("as", viewerType);
      if (draft.kind !== "VOICE" && draft.body) formData.set("body", draft.body);
      if (draft.projectId) formData.set("projectId", draft.projectId);

      try {
        if (draft.kind === "IMAGE") formData.set("photo", await shrinkPhoto(draft.file));
        if (draft.kind === "FILE") formData.set("document", draft.file);
        if (draft.kind === "VOICE") {
          formData.set("voice", draft.blob, draft.fileName);
          formData.set("durationSeconds", String(draft.durationSeconds));
        }

        const saved = await sendChatMessage(formData);
        setMessages((current) =>
          reconcile(current, tempId, saved ? ({ ...saved, createdAt: new Date(saved.createdAt) } as Message) : null)
        );
        // The saved copy points at the server's file now; let the phone's go.
        if (preview) setTimeout(() => URL.revokeObjectURL(preview), 10_000);
      } catch (error) {
        setMessages((current) =>
          current.map((message) => (message.id === tempId ? { ...message, status: "failed" } : message))
        );
        throw error;
      }
    },
    [conversation, projects, viewerType, viewerId]
  );

  // --- tasks ---------------------------------------------------------------
  const openTaskSheet = useCallback((title: string) => setSheet({ key: Date.now(), title }), []);
  const openMeetingSheet = useCallback((title: string) => setMeetingSheet({ key: Date.now(), title }), []);

  // The form stays open until the task is saved, then the card goes straight
  // into the conversation; the stream's copy of it later changes nothing.
  const createTask = useCallback(
    async (formData: FormData) => {
      formData.set("conversation", conversation);
      const saved = await createChatTask(formData);
      pinnedToBottom.current = true;
      setMessages((current) =>
        current.some((message) => message.id === saved.id)
          ? current
          : [...current, { ...saved, createdAt: new Date(saved.createdAt) } as Message]
      );
      setSheet(null);
    },
    [conversation]
  );

  // The same path as a task card: the saved message is appended directly rather
  // than waiting for the stream, so setting a meeting feels as quick as sending.
  const createMeeting = useCallback(
    async (formData: FormData) => {
      formData.set("conversation", conversation);
      const saved = await createChatMeeting(formData);
      pinnedToBottom.current = true;
      setMessages((current) =>
        current.some((message) => message.id === saved.id)
          ? current
          : [...current, { ...saved, createdAt: new Date(saved.createdAt) } as Message]
      );
      setMeetingSheet(null);
    },
    [conversation]
  );

  const dayHeadings = useMemo(
    () =>
      visible.map((message, index) => {
        const day = dayLabel(new Date(message.createdAt));
        const previous = index > 0 ? dayLabel(new Date(visible[index - 1].createdAt)) : null;
        return day === previous ? null : day;
      }),
    [visible]
  );

  // The stream is the only source of these: a message does not carry its own
  // reactions, because reading a fifth relation alongside the four already in
  // messageSelect closes the local database's connection (the note beside that
  // select has the measurements). Nothing is shown until the first snapshot,
  // which arrives on the stream's first look rather than a poll later.
  const reactionsOf = useCallback(
    (message: Message) => liveReactions?.byMessage.get(message.id) ?? [],
    [liveReactions]
  );

  // The same for pins: the stream's list while there is one, and until then
  // whatever the page was drawn with.
  const pinned = useMemo(() => {
    if (liveReactions) return liveReactions.pinned;
    return present
      .filter((message) => message.pinnedAt)
      .sort((a, b) => new Date(b.pinnedAt as Date).getTime() - new Date(a.pinnedAt as Date).getTime())
      .map((message) => ({
        id: message.id,
        kind: message.kind,
        body: message.body,
        attachmentName: message.attachmentName,
        authorName: message.authorName,
        pinnedAt: new Date(message.pinnedAt as Date).toISOString(),
        pinnedByName: message.pinnedByName,
      }));
  }, [liveReactions, present]);

  // Which messages carry a pin, so the bar above and the bubble itself never
  // disagree about what is pinned.
  const pinnedIds = useMemo(() => new Set(pinned.map((one) => one.id)), [pinned]);

  return (
    <div className="flex h-full flex-col bg-canvas">
      {header && (
        <ChatHeader
          variant={variant}
          name={header.name}
          subtitle={header.subtitle}
          status={status}
          avatar={header.avatar}
          backHref={header.backHref}
          actions={
            <div className="flex shrink-0 items-center gap-1">
              {studio && (
                <SearchInHeader
                  value={search}
                  onChange={setSearch}
                  found={needle ? visible.length : null}
                />
              )}
              <CallButtons conversation={conversation} title={header.name} viewer={viewer} />
            </div>
          }
        />
      )}
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className={cn("relative flex-1 overflow-y-auto", studio ? "px-4 py-4 lg:px-8" : "px-3 py-3")}
        // The faint tile behind a chat, drawn rather than fetched.
        style={
          studio
            ? undefined
            : {
                backgroundImage:
                  "radial-gradient(circle at 20% 30%, rgba(21,19,31,0.035) 1px, transparent 1px), radial-gradient(circle at 70% 80%, rgba(21,19,31,0.03) 1px, transparent 1px)",
                backgroundSize: "56px 56px, 84px 84px",
              }
        }
      >
        {studio && (
          <p
            aria-hidden
            className="pointer-events-none sticky top-0 z-0 -mt-1 mb-2 ml-auto w-max whitespace-nowrap text-right font-display text-[11px] uppercase leading-4 tracking-[0.3em] text-bark/15"
          >
            Good design
            <br />
            better living
          </p>
        )}

        {pinned.length > 0 && <PinnedBar pinned={pinned} studio={studio} />}

        {visible.length === 0 && (
          <p className={cn("mt-12 text-center text-sm", studio ? "text-bark/40" : "text-ink/40")}>
            {needle
              ? `Nothing in this conversation matches “${search?.trim()}”.`
              : (emptyText ?? "No messages yet. Send an update, a photo from site, or a voice note.")}
          </p>
        )}

        {visible.map((message, index) =>
          message.kind === "TASK" && message.task ? (
            <TaskMessage
              key={message.id}
              day={dayHeadings[index]}
              mine={isMine(message)}
              time={timeLabel(new Date(message.createdAt))}
              studio={studio}
            >
              <TaskCard
                task={liveTasks?.byId.get(message.task.id) ?? message.task}
                viewer={viewer}
                timeZone={timeZone}
                initialNow={initialNow}
                onDeleted={() => setMessages((current) => current.filter((item) => item.id !== message.id))}
              />
            </TaskMessage>
          ) : message.kind === "MEETING" && message.meeting ? (
            <TaskMessage
              key={message.id}
              day={dayHeadings[index]}
              mine={isMine(message)}
              time={timeLabel(new Date(message.createdAt))}
              studio={studio}
            >
              <MeetingCard
                meeting={liveMeetings?.byId.get(message.meeting.id) ?? message.meeting}
                viewer={viewer}
                conversation={conversation}
                timeZone={timeZone}
                initialNow={initialNow}
                onCancelled={() => setMessages((current) => current.filter((item) => item.id !== message.id))}
              />
            </TaskMessage>
          ) : message.kind === "CALL" ? (
            // What a call left behind: one line across the conversation, not a bubble from somebody.
            <div key={message.id}>
              {dayHeadings[index] ? <DayHeading day={dayHeadings[index] as string} studio={studio} /> : null}
              <p className="my-2 flex justify-center">
                <span
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-sm",
                    message.call?.endReason === "completed"
                      ? studio
                        ? "bg-card text-bark/60"
                        : "bg-card text-ink/65"
                      : "bg-red-50 text-red-700"
                  )}
                >
                  {message.call?.endReason !== "completed" ? (
                    <PhoneMissed size={14} aria-hidden />
                  ) : message.call?.kind === "VIDEO" ? (
                    <Video size={14} aria-hidden />
                  ) : (
                    <Phone size={14} aria-hidden />
                  )}
                  <span>{message.body}</span>
                  <span className={studio ? "text-bark/30" : "text-ink/35"}>
                    {timeLabel(new Date(message.createdAt))}
                  </span>
                </span>
              </p>
            </div>
          ) : (
            <Bubble
              key={message.id}
              message={message}
              day={dayHeadings[index]}
              mine={isMine(message)}
              showName={showNames}
              canDelete={canDeleteAny}
              studio={studio}
              readAt={otherKey ? people.reads[otherKey] : null}
              reactions={reactionsOf(message)}
              pinned={pinnedIds.has(message.id)}
              myKey={myKey}
              as={viewerType}
              onDiscard={
                message.status
                  ? () => setMessages((current) => current.filter((item) => item.id !== message.id))
                  : undefined
              }
            />
          )
        )}

        <div ref={bottomRef} />
      </div>

      {people.typing.length > 0 && (
        <p
          aria-live="polite"
          className={cn("shrink-0 px-4 pb-1 text-xs italic", studio ? "text-bark/50" : "text-ink/50")}
        >
          {people.typing.length === 1
            ? `${people.typing[0].name} is writing…`
            : `${people.typing.map((one) => one.name).join(", ")} are writing…`}
        </p>
      )}

      <Composer
        projects={projects}
        conversation={conversation}
        as={viewerType}
        onSend={sendDraft}
        onTask={taskSetup ? openTaskSheet : undefined}
        onMeeting={meetingSetup ? openMeetingSheet : undefined}
        studio={studio}
      />

      {sheet && taskSetup && (
        <TaskSheet
          key={sheet.key}
          setup={taskSetup}
          initialTitle={sheet.title}
          onClose={() => setSheet(null)}
          onCreate={createTask}
        />
      )}

      {meetingSheet && meetingSetup && (
        <MeetingSheet
          key={meetingSheet.key}
          setup={meetingSetup}
          initialTitle={meetingSheet.title}
          onClose={() => setMeetingSheet(null)}
          onCreate={createMeeting}
        />
      )}
    </div>
  );
}

/** Looking for something that was said: the header's search, open only while it is used. */
function SearchInHeader({
  value,
  onChange,
  found,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  /** How many messages match, once something has been typed. */
  found: number | null;
}) {
  if (value === null) {
    return (
      <button
        type="button"
        onClick={() => onChange("")}
        aria-label="Search this conversation"
        title="Search this conversation"
        className="flex h-10 w-10 items-center justify-center rounded-full text-bark/45 transition-colors hover:bg-clay-soft/70 hover:text-bark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay/40"
      >
        <Search size={19} strokeWidth={2} />
      </button>
    );
  }

  return (
    <span className="relative flex items-center">
      <Search size={14} aria-hidden className="pointer-events-none absolute left-3 text-bark/35" />
      <input
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onChange(null);
        }}
        placeholder="Search this chat…"
        aria-label="Search this conversation"
        className="h-10 w-44 rounded-full border border-warm-line bg-paper-soft pl-8 pr-8 text-sm text-bark outline-none placeholder:text-bark/35 focus:border-clay lg:w-60"
      />
      {found !== null && (
        <span className="pointer-events-none absolute right-9 text-[11px] tabular-nums text-bark/35">{found}</span>
      )}
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-label="Close the search"
        className="absolute right-2 flex h-6 w-6 items-center justify-center rounded-full text-bark/40 hover:bg-bark/5 hover:text-bark"
      >
        <X size={14} />
      </button>
    </span>
  );
}

function DayHeading({ day, studio = false }: { day: string; studio?: boolean }) {
  return (
    <div className="relative z-10 my-3 flex justify-center">
      <span
        className={cn(
          "rounded-lg px-3 py-1 text-[11px] font-medium uppercase tracking-wide shadow-sm",
          "bg-card", studio ? "text-bark/45" : "text-bark/50"
        )}
      >
        {day}
      </span>
    </div>
  );
}

/** A task card in the conversation, on the side of whoever handed it out, with the time under it. */
function TaskMessage({
  day,
  mine,
  time,
  studio = false,
  children,
}: {
  day: string | null;
  mine: boolean;
  time: string;
  studio?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      {day && <DayHeading day={day} studio={studio} />}
      <div className={cn("relative z-10 mb-2 flex", mine ? "justify-end" : "justify-start")}>
        <div className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
          {children}
          <span className={cn("mt-0.5 px-1 text-[11px]", studio ? "text-bark/35" : "text-ink/40")}>{time}</span>
        </div>
      </div>
    </>
  );
}

function Bubble({
  message,
  day,
  mine,
  showName,
  canDelete,
  studio = false,
  readAt = null,
  reactions,
  pinned,
  myKey,
  as,
  onDiscard,
}: {
  message: Message;
  day: string | null;
  mine: boolean;
  /** In the group, whose message it is; in a private chat that goes without saying. */
  showName: boolean;
  canDelete: boolean;
  studio?: boolean;
  /**
   * How far the other person has read this conversation, in a private chat —
   * null in the group, where one pair of ticks cannot mean "everybody", and
   * null before they have ever opened it, which is not the same as unread.
   */
  readAt?: string | null;
  /** What people gave this message, from the stream or the page's first draw. */
  reactions: ReactionRow[];
  /** Whether it is one of the conversation's pinned messages. */
  pinned: boolean;
  /** How the person looking is keyed, so the row can say which are theirs. */
  myKey: string;
  /** Which of the two sessions a browser may hold is reacting. */
  as: "ADMIN" | "EMPLOYEE";
  /** Removes one of our own copies that never made it. */
  onDiscard?: () => void;
}) {
  const [, startTransition] = useTransition();
  const [picking, setPicking] = useState(false);
  // My own reactions, applied the instant I tap.
  //
  // Everybody else's come from the stream, which is a poll away — and a tap
  // that takes a second to show reads as a tap that did nothing. Only my own
  // rows are overridden, because from this screen only I change them; the
  // stream stays the authority on everybody else's, and on the pin, which is
  // a deliberate act rather than a tap and can afford to wait for the truth.
  const [minePressed, setMinePressed] = useState<Record<string, boolean>>({});

  const isAgent = message.authorType === "AGENT";
  const created = new Date(message.createdAt);
  // A face beside what somebody else said, so a long conversation reads at a glance.
  const withFace = studio && !mine && !isAgent;

  const rows = useMemo(() => {
    const others = reactions.filter((row) => row.memberKey !== myKey);
    const mineNow = new Set(reactions.filter((row) => row.memberKey === myKey).map((row) => row.emoji));
    for (const [emoji, on] of Object.entries(minePressed)) {
      if (on) mineNow.add(emoji);
      else mineNow.delete(emoji);
    }
    return tally(
      [...others, ...[...mineNow].map((emoji) => ({ emoji, memberKey: myKey, memberName: "You" }))],
      myKey
    );
  }, [reactions, myKey, minePressed]);

  const press = (emoji: string) => {
    const already = rows.some((one) => one.emoji === emoji && one.mine);
    setMinePressed((current) => ({ ...current, [emoji]: !already }));
    setPicking(false);
    startTransition(() => {
      // A reaction the server refused goes back the way it was, rather than
      // staying on screen as something that never happened.
      void reactToMessage(message.id, emoji, as).catch(() =>
        setMinePressed((current) => ({ ...current, [emoji]: already }))
      );
    });
  };

  return (
    <>
      {day && <DayHeading day={day} studio={studio} />}

      <div
        id={`message-${message.id}`}
        className={cn(
          "group/msg relative z-10 flex gap-2",
          // The face sits beside the name it belongs to, at the top of what
          // was said, rather than at the foot of a long message.
          studio ? "mb-3 items-start" : "mb-1.5 items-end",
          mine && !isAgent ? "justify-end" : "justify-start"
        )}
      >
        {withFace && (
          <PersonAvatar
            name={message.authorName || "?"}
            color={faceColour(message.authorName || "?")}
            size={32}
            className="mt-1 shrink-0"
          />
        )}

        <div
          className={cn(
            "relative shadow-sm",
            studio ? "max-w-[85%] rounded-2xl px-3.5 py-2.5 lg:max-w-[68%]" : "max-w-[85%] rounded-xl px-2.5 py-1.5 sm:max-w-[70%]",
            isAgent
              ? "border border-purple/25 bg-purple/[0.08]"
              : studio
                ? mine
                  ? "border border-clay/20 bg-clay-soft/70"
                  : "border border-warm-line bg-card"
                : mine
                  ? "border border-clay/20 bg-clay-soft/70"
                  : "border border-warm-line bg-card"
          )}
        >
          {!mine && (showName || isAgent) && (
            <p
              className={cn(
                "mb-0.5 text-[13px] font-semibold",
                isAgent ? "text-purple-strong" : nameColour(message.authorName)
              )}
            >
              {isAgent && <Bot size={12} strokeWidth={2.5} className="mr-1 inline" />}
              {message.authorName}
              {message.authorType === "ADMIN" && message.authorName !== "Manager" && " · Manager"}
            </p>
          )}

          {message.kind === "IMAGE" && message.attachmentUrl && (
            <a
              href={message.status ? undefined : message.attachmentUrl}
              target="_blank"
              rel="noreferrer"
              className="relative mb-1 block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={message.attachmentUrl}
                alt={message.attachmentName ?? "Photo"}
                className="max-h-80 w-full rounded-lg object-cover"
              />
              {message.status === "sending" && (
                <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/25">
                  <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-white/40 border-t-white" />
                </span>
              )}
            </a>
          )}

          {message.kind === "VOICE" && message.attachmentUrl && (
            <VoiceNote url={message.attachmentUrl} seconds={message.durationSeconds} mine={mine} studio={studio} />
          )}

          {message.kind === "FILE" && message.attachmentUrl && (
            <a
              href={message.attachmentUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "mb-1 flex items-center gap-2 rounded-lg px-2 py-2 text-sm",
                studio ? "bg-bark/[0.04] text-bark/80" : mine ? "bg-black/5" : "bg-ink/5"
              )}
            >
              <FileText size={18} strokeWidth={1.75} className={studio ? "shrink-0 text-bark/45" : "shrink-0 text-ink/50"} />
              <span className="min-w-0 flex-1 truncate">{message.attachmentName}</span>
            </a>
          )}

          {message.body && (
            <p
              dir="auto"
              className={cn(
                "whitespace-pre-wrap break-words pr-12 leading-snug",
                studio ? "text-[15px] text-bark" : "text-[15px] text-ink"
              )}
            >
              {message.body}
            </p>
          )}

          {/* Time tucked into the bottom-right of the bubble. */}
          <span
            className={cn(
              "pointer-events-none float-right -mb-0.5 ml-2 mt-1 inline-flex items-center gap-1 text-[11px]",
              studio ? "text-bark/35" : "text-ink/40"
            )}
          >
            {message.project && <span className="max-w-24 truncate">{message.project.name}</span>}
            {timeLabel(created)}
            {mine && !isAgent && message.status === "sending" && (
              <Clock size={12} strokeWidth={2} className={studio ? "text-bark/35" : "text-ink/40"} aria-label="Sending" />
            )}
            {mine && !isAgent && message.status === "failed" && (
              <CircleAlert size={13} strokeWidth={2} className="text-red-500" aria-label="Not sent" />
            )}
            {mine && !isAgent && !message.status && (
              // Two ticks mean saved; coloured, they mean the other person has
              // opened the conversation since this arrived. In the group readAt
              // is null and it stays at "Sent" — one pair of ticks cannot say
              // "everybody", and claiming it would be the easiest lie here.
              <CheckCheck
                size={13}
                strokeWidth={2}
                className={cn(
                  isReadBy(message.createdAt, readAt)
                    ? "text-sky-500"
                    : studio
                      ? "text-bark/35"
                      : "text-ink/40"
                )}
                aria-label={isReadBy(message.createdAt, readAt) ? "Read" : "Sent"}
              />
            )}
          </span>

          {message.status === "failed" && (
            <button type="button" onClick={onDiscard} className="mt-1 block text-[11px] font-medium text-red-600">
              Not sent · tap to remove
            </button>
          )}

          {/* What people said back without saying anything. */}
          {rows.length > 0 && (
            <div className="clear-both flex flex-wrap gap-1 pt-1.5">
              {rows.map((one) => (
                <button
                  key={one.emoji}
                  type="button"
                  onClick={() => press(one.emoji)}
                  title={one.names.join(", ")}
                  aria-pressed={one.mine}
                  aria-label={`${one.emoji} from ${one.names.join(", ")}`}
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-1.5 py-0.5 leading-none transition-colors",
                    one.mine
                      ? studio
                        ? "border-clay/40 bg-clay-soft text-bark"
                        : "border-clay/40 bg-clay-soft/70 text-ink"
                      : studio
                        ? "border-warm-line bg-paper-soft text-bark/70 hover:border-clay/40"
                        : "border-ink/10 bg-ink/[0.03] text-ink/70 hover:border-ink/25"
                  )}
                >
                  <span className="text-[13px]">{one.emoji}</span>
                  <span className="text-[11px] tabular-nums">{one.count}</span>
                </button>
              ))}
            </div>
          )}

          {/* The six, while somebody is choosing one. */}
          {picking && !message.status && (
            <div
              className={cn(
                "absolute -top-10 z-30 flex gap-0.5 rounded-full border px-1.5 py-1 shadow-lg",
                studio ? "border-warm-line bg-card" : "border-ink/10 bg-white",
                mine ? "right-0" : "left-0"
              )}
            >
              {REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => press(emoji)}
                  aria-label={`React with ${emoji}`}
                  className="rounded-full px-1 text-lg leading-none transition-transform hover:scale-125"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {/* React, pin, delete — one cluster, and only on a message that exists. */}
          {!isAgent && !message.status && (
            <div
              className={cn(
                "absolute -top-3 flex items-center gap-0.5 rounded-full border p-0.5 opacity-0 shadow-sm transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100",
                studio ? "border-warm-line bg-card" : "border-ink/10 bg-white",
                mine ? "-left-2" : "-right-2"
              )}
            >
              <button
                type="button"
                onClick={() => setPicking(!picking)}
                aria-label="React to this message"
                aria-expanded={picking}
                className={cn(
                  "rounded-full p-1 transition-colors",
                  studio ? "text-bark/40 hover:bg-clay-soft hover:text-bark" : "text-ink/35 hover:bg-ink/5 hover:text-ink"
                )}
              >
                <SmilePlus size={12} strokeWidth={2} />
              </button>

              <button
                type="button"
                onClick={() => {
                  startTransition(() => {
                    void setMessagePinned(message.id, !pinned, as).catch(() => undefined);
                  });
                }}
                aria-label={pinned ? "Unpin this message" : "Pin this message"}
                aria-pressed={pinned}
                className={cn(
                  "rounded-full p-1 transition-colors",
                  pinned
                    ? "text-clay"
                    : studio
                      ? "text-bark/40 hover:bg-clay-soft hover:text-bark"
                      : "text-ink/35 hover:bg-ink/5 hover:text-ink"
                )}
              >
                <Pin size={12} strokeWidth={2} />
              </button>

              {(canDelete || mine) && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("Delete this message?")) startTransition(() => deleteChatMessage(message.id));
                  }}
                  aria-label="Delete message"
                  className={cn(
                    "rounded-full p-1 transition-colors",
                    studio ? "text-bark/40 hover:text-red-600" : "text-ink/35 hover:text-red-600"
                  )}
                >
                  <Trash2 size={11} strokeWidth={2} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/** What a pinned message is called in one line, when its words are not the point. */
function pinnedPreview(one: PinnedView) {
  if (one.body) return one.body;
  if (one.attachmentName) return one.attachmentName;
  if (one.kind === "IMAGE") return "Photo";
  if (one.kind === "VOICE") return "Voice message";
  if (one.kind === "FILE") return "File";
  return "Message";
}

/**
 * What this conversation has been asked to keep in view, above everything else
 * in it. The newest pin is the one on show; the rest are behind a count, so a
 * bar meant to be read on the way past stays one line high.
 */
function PinnedBar({ pinned, studio }: { pinned: PinnedView[]; studio: boolean }) {
  const [open, setOpen] = useState(false);

  const jump = (id: string) => {
    const el = document.getElementById(`message-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.add("task-flash");
    setTimeout(() => el.classList.remove("task-flash"), 2600);
  };

  const line = (one: PinnedView, first: boolean) => (
    <button
      key={one.id}
      type="button"
      onClick={() => jump(one.id)}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors",
        studio ? "hover:bg-clay-soft/60" : "hover:bg-ink/[0.04]"
      )}
    >
      <Pin
        size={13}
        strokeWidth={2}
        aria-hidden
        className={cn("shrink-0", first ? "text-clay" : studio ? "text-bark/30" : "text-ink/30")}
      />
      <span className="min-w-0 flex-1 truncate text-xs">
        <span className={studio ? "font-semibold text-bark" : "font-semibold text-ink"}>{one.authorName}</span>
        <span className={studio ? "text-bark/60" : "text-ink/60"}> · {pinnedPreview(one)}</span>
      </span>
      {one.pinnedByName && (
        <span className={cn("shrink-0 text-[10px]", studio ? "text-bark/35" : "text-ink/35")}>
          pinned by {one.pinnedByName}
        </span>
      )}
    </button>
  );

  return (
    <div
      className={cn(
        "sticky top-0 z-20 mb-3 rounded-xl border px-2 py-1.5 shadow-sm",
        studio ? "border-warm-line bg-card" : "border-ink/10 bg-white/95"
      )}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">{line(pinned[0], true)}</span>
        {pinned.length > 1 && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className={cn(
              "shrink-0 rounded-full px-2 py-1 text-[11px] font-medium transition-colors",
              studio ? "text-bark/50 hover:bg-clay-soft hover:text-bark" : "text-ink/50 hover:bg-ink/5 hover:text-ink"
            )}
          >
            {open ? "Hide" : `${pinned.length} pinned`}
          </button>
        )}
      </div>

      {open && <div className="mt-1 border-t pt-1">{pinned.slice(1).map((one) => line(one, false))}</div>}
    </div>
  );
}

/** A voice note: play, a scrubbable bar, and how long it runs. */
function VoiceNote({
  url,
  seconds,
  mine,
  studio = false,
}: {
  url: string;
  seconds: number | null;
  mine: boolean;
  studio?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const total = seconds ?? 0;

  return (
    <div className="mb-1 flex min-w-56 items-center gap-2.5 py-1">
      <button
        type="button"
        onClick={() => {
          const audio = audioRef.current;
          if (!audio) return;
          if (audio.paused) {
            void audio.play();
          } else {
            audio.pause();
          }
        }}
        aria-label={playing ? "Pause" : "Play"}
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          studio || mine ? "bg-clay/15 text-clay-deep" : "bg-ink/5 text-ink/60"
        )}
      >
        {playing ? (
          <span className="flex gap-0.5">
            <span className="h-3 w-1 rounded-sm bg-current" />
            <span className="h-3 w-1 rounded-sm bg-current" />
          </span>
        ) : (
          <span className="ml-0.5 h-0 w-0 border-y-[6px] border-l-[10px] border-y-transparent border-l-current" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className={cn("h-1.5 overflow-hidden rounded-full", studio ? "bg-bark/10" : "bg-ink/10")}>
          <div
            className={cn(
              "h-full rounded-full transition-[width]",
              studio || mine ? "bg-clay" : "bg-clay/45"
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className={cn("mt-1 text-[11px]", studio ? "text-bark/40" : "text-ink/40")}>
          {total ? `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}` : "voice"}
        </p>
      </div>

      <audio
        ref={audioRef}
        src={url}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
        onTimeUpdate={(event) => {
          const audio = event.currentTarget;
          if (audio.duration) setProgress((audio.currentTime / audio.duration) * 100);
        }}
        className="hidden"
      />
    </div>
  );
}

// --- the composer ----------------------------------------------------------

function Composer({
  projects,
  conversation,
  as,
  onSend,
  onTask,
  onMeeting,
  studio = false,
}: {
  projects: { id: string; name: string }[];
  /** The conversation as its URL names it — what a typing note is about. */
  conversation: string;
  /** Which of the two sessions a browser may hold is writing. */
  as: "ADMIN" | "EMPLOYEE";
  onSend: (draft: Draft) => Promise<void>;
  /** Opens the task form, with a title when "/task …" was typed. Only where tasks can be handed out. */
  onTask?: (title: string) => void;
  /** Opens the meeting form, with a title when "/meet …" was typed. Only where meetings can be set. */
  onMeeting?: (title: string) => void;
  studio?: boolean;
}) {
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState("");

  // "Wael is writing…" — at a cadence, not a keystroke. The note lives a few
  // seconds on the server, so re-stamping every four keeps it alive without a
  // request per letter. Nothing has to say "stopped": a note nobody refreshes
  // ages out on its own, which is why stopping and closing the tab look the
  // same — and both are true.
  const lastPing = useRef(0);
  const tellTyping = (typing: boolean) => {
    if (typing) {
      const at = Date.now();
      if (at - lastPing.current < 4000) return;
      lastPing.current = at;
    } else {
      lastPing.current = 0;
    }
    void fetch("/api/chat/typing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation, as, typing }),
    }).catch(() => undefined);
  };
  const [showAttach, setShowAttach] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  // Hold to record, let go to send, slide left to cancel — WhatsApp's gesture.
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [slide, setSlide] = useState(0);

  const held = useRef(false);
  const cancelled = useRef(false);
  const startedAt = useRef(0);
  const originX = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  const photoRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Holding the mic started iOS's text selection and its callout menu: a long
  // press is a selection gesture unless the touch is claimed. React listens to
  // touches passively and cannot claim one, so this does it on the button.
  const claimTouch = useCallback((node: HTMLButtonElement | null) => {
    if (!node) return;
    const claim = (event: TouchEvent) => event.preventDefault();
    node.addEventListener("touchstart", claim, { passive: false });
    return () => node.removeEventListener("touchstart", claim);
  }, []);

  useEffect(() => {
    return () => {
      if (ticker.current) clearInterval(ticker.current);
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function fail(cause: unknown) {
    setError(cause instanceof Error ? cause.message : "Could not send that.");
  }

  function send(body: string) {
    const trimmed = body.trim();
    if (!trimmed) return;
    // Cleared at once: the message is already on screen, waiting for its tick.
    setText("");
    tellTyping(false);
    setShowAttach(false);
    setError(null);
    if (textRef.current) textRef.current.style.height = "auto";

    // "/task …" opens the task form instead of sending the words.
    const slash = onTask ? slashTask(trimmed) : null;
    if (slash && onTask) {
      onTask(slash.title);
      return;
    }

    // "/meet …" does the same for a meeting.
    const meet = onMeeting ? slashMeeting(trimmed) : null;
    if (meet && onMeeting) {
      onMeeting(meet.title);
      return;
    }

    void onSend({ kind: "TEXT", body: trimmed, projectId }).catch(fail);
  }

  function sendFile(kind: "IMAGE" | "FILE", file: File) {
    const body = text.trim();
    setText("");
    setShowAttach(false);
    setError(null);
    void onSend({ kind, file, body, projectId }).catch(fail);
  }

  async function pressMic(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    // The button stays mounted while recording and keeps this finger, so the
    // release is heard wherever it happens. It used to be swapped out for the
    // recording bar, and the release went to a button that was gone.
    event.currentTarget.setPointerCapture(event.pointerId);
    held.current = true;
    cancelled.current = false;
    originX.current = event.clientX;
    setSlide(0);
    setError(null);
    setHint(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      held.current = false;
      setError("Could not use the microphone. Allow it for NEON Tasks in Settings, then try again.");
      return;
    }

    // The finger came up while the microphone was starting — or while the
    // permission prompt was on screen, the first time. Nothing to send.
    if (!held.current) {
      stream.getTracks().forEach((track) => track.stop());
      setHint("Hold to record, release to send");
      return;
    }

    const type = pickAudioType(
      (candidate) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate)
    );
    const media = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
    chunks.current = [];

    media.ondataavailable = (data) => {
      if (data.data.size > 0) chunks.current.push(data.data);
    };

    media.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      if (ticker.current) clearInterval(ticker.current);
      setRecording(false);
      setElapsed(0);
      setSlide(0);

      // Timed by the clock: the old count was frozen at zero, so every note
      // looked too short and was thrown away on release.
      const outcome = recordingOutcome(Date.now() - startedAt.current, cancelled.current);
      if (outcome.kind === "too-short") {
        setHint("Hold to record, release to send");
        return;
      }
      if (outcome.kind !== "send" || chunks.current.length === 0) return;

      const mime = baseAudioType(media.mimeType || type || "audio/mp4");
      const blob = new Blob(chunks.current, { type: mime });
      void onSend({
        kind: "VOICE",
        blob,
        fileName: `voice-${Date.now()}.${audioExtension(mime)}`,
        durationSeconds: outcome.seconds,
        projectId,
      }).catch(fail);
    };

    startedAt.current = Date.now();
    media.start();
    recorder.current = media;
    setRecording(true);
    ticker.current = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 250);
  }

  function moveMic(event: React.PointerEvent<HTMLButtonElement>) {
    if (!held.current || !recording) return;
    const dx = Math.min(0, event.clientX - originX.current);
    setSlide(dx);
    if (dx <= -SLIDE_TO_CANCEL_PX) finishRecording(true);
  }

  function finishRecording(cancel: boolean) {
    if (!held.current) return;
    held.current = false;
    cancelled.current = cancel;
    const media = recorder.current;
    recorder.current = null;
    if (media && media.state !== "inactive") media.stop();
  }

  const hasText = text.trim().length > 0;

  return (
    <div
      className={cn(
        "chat-composer select-none border-t",
        "border-warm-line bg-card",
        studio ? "px-3 py-3 lg:px-5" : "px-2 py-2"
      )}
    >
      {error && <p className="px-2 pb-1.5 text-xs text-red-600">{error}</p>}
      {hint && !recording && (
        <p className={cn("px-2 pb-1.5 text-center text-xs", studio ? "text-bark/50" : "text-ink/50")}>{hint}</p>
      )}

      {/* The four answers a team gives all day, one tap away. */}
      {studio && !recording && !hasText && (
        <div className="mb-2.5">
          <QuickReplies onPick={send} />
        </div>
      )}

      {showAttach && !recording && (
        <div className="mb-2 flex flex-wrap gap-2 px-1">
          {onTask && (
            <AttachButton
              label="Task"
              studio={studio}
              onClick={() => {
                setShowAttach(false);
                onTask("");
              }}
            >
              <ClipboardList size={18} strokeWidth={1.75} />
            </AttachButton>
          )}
          {onMeeting && (
            <AttachButton
              label="Meeting"
              studio={studio}
              onClick={() => {
                setShowAttach(false);
                onMeeting("");
              }}
            >
              <CalendarClock size={18} strokeWidth={1.75} />
            </AttachButton>
          )}
          <AttachButton label="Photo" studio={studio} onClick={() => photoRef.current?.click()}>
            <Camera size={18} strokeWidth={1.75} />
          </AttachButton>
          <AttachButton label="File" studio={studio} onClick={() => fileRef.current?.click()}>
            <Paperclip size={18} strokeWidth={1.75} />
          </AttachButton>
          {projects.length > 0 && (
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              aria-label="Project this is about"
              className={cn(
                "min-w-0 flex-1 rounded-xl border px-2 py-1.5 text-xs outline-none",
                studio ? "border-warm-line bg-paper-soft text-bark/75" : "border-ink/12 bg-white text-ink/70"
              )}
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) sendFile("IMAGE", file);
          event.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) sendFile("IMAGE", file);
          event.target.value = "";
        }}
      />
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) sendFile("FILE", file);
          event.target.value = "";
        }}
      />

      <div className="flex items-end gap-1.5">
        {recording ? (
          <div
            className={cn(
              "flex h-11 min-w-0 flex-1 items-center gap-3 rounded-full px-4",
              studio ? "bg-paper-soft" : "bg-white"
            )}
          >
            <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
            <span className={cn("font-mono text-sm tabular-nums", studio ? "text-bark/70" : "text-ink/70")}>
              {formatDuration(elapsed)}
            </span>
            <span
              className={cn("flex flex-1 items-center justify-center gap-1 text-xs", studio ? "text-bark/45" : "text-ink/45")}
              style={{
                transform: `translateX(${slide / 2}px)`,
                opacity: Math.max(0.2, 1 + slide / SLIDE_TO_CANCEL_PX),
              }}
            >
              <ChevronLeft size={14} strokeWidth={2} />
              Slide to cancel
            </span>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setShowAttach(!showAttach)}
              aria-label="Attach"
              aria-expanded={showAttach}
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors",
                studio ? "text-bark/45 hover:bg-clay-soft/70 hover:text-bark" : "text-ink/45 hover:bg-ink/5"
              )}
            >
              <Plus size={22} strokeWidth={2} className={cn("transition-transform", showAttach && "rotate-45")} />
            </button>

            <div
              className={cn(
                "flex min-w-0 flex-1 items-end rounded-3xl border border-warm-line bg-paper-soft px-3 py-1.5"
              )}
            >
              <textarea
                ref={textRef}
                value={text}
                rows={1}
                dir="auto"
                placeholder={studio ? "Type a message…" : "Message"}
                aria-label="Message"
                onChange={(event) => {
                  setText(event.target.value);
                  tellTyping(event.target.value.trim().length > 0);
                  // Grow with the text, like a messaging app, up to a limit.
                  const el = event.target;
                  el.style.height = "auto";
                  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send(text);
                  }
                }}
                className={cn(
                  "max-h-30 min-h-6 w-full select-text resize-none bg-transparent py-1 text-base outline-none",
                  studio && "text-bark placeholder:text-bark/35"
                )}
              />
              {studio && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  aria-label="Attach a file"
                  className="mb-1 ml-2 shrink-0 text-bark/40 transition-colors hover:text-bark"
                >
                  <Paperclip size={19} strokeWidth={1.75} />
                </button>
              )}
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                aria-label="Take a photo"
                className={cn(
                  "mb-1 ml-2 shrink-0 transition-colors",
                  studio ? "text-bark/40 hover:text-bark" : "text-ink/40 hover:text-ink"
                )}
              >
                <Camera size={20} strokeWidth={1.75} />
              </button>
            </div>
          </>
        )}

        {hasText && !recording ? (
          <button
            type="button"
            onClick={() => send(text)}
            // Keeps the keyboard up after sending, as WhatsApp does.
            onMouseDown={(event) => event.preventDefault()}
            aria-label="Send"
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-transform active:scale-95",
              studio ? "bg-clay hover:bg-clay-deep" : "bg-emerald-600"
            )}
          >
            <Send size={18} strokeWidth={2} />
          </button>
        ) : (
          <button
            ref={claimTouch}
            type="button"
            aria-label="Hold to record a voice message"
            onPointerDown={pressMic}
            onPointerMove={moveMic}
            onPointerUp={() => finishRecording(false)}
            onPointerCancel={() => finishRecording(true)}
            onContextMenu={(event) => event.preventDefault()}
            className={cn(
              "flex h-11 w-11 shrink-0 touch-none select-none items-center justify-center rounded-full text-white transition-transform [-webkit-touch-callout:none]",
              "bg-clay hover:bg-clay-deep",
              recording && "scale-125 shadow-lg"
            )}
          >
            <Mic size={19} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}

function AttachButton({
  label,
  onClick,
  studio = false,
  children,
}: {
  label: string;
  onClick: () => void;
  studio?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2",
        studio
          ? "border-warm-line bg-paper-soft text-bark/75 hover:bg-clay-soft/70 focus-visible:ring-clay/40"
          : "border-ink/12 bg-white text-ink/70 hover:bg-ink/[0.03] focus-visible:ring-cyan-strong/40"
      )}
    >
      {children}
      {label}
    </button>
  );
}
