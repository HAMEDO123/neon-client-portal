"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Bot,
  Camera,
  CheckCheck,
  ChevronLeft,
  CircleAlert,
  Clock,
  FileText,
  Mic,
  Paperclip,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { deleteChatMessage, sendChatMessage } from "@/lib/actions/chat-actions";
import { ChatHeader } from "@/components/chat/chat-header";
import { shrinkPhoto } from "@/lib/client-image";
import { mergeIncoming, pendingId, reconcile } from "@/lib/chat-sync";
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
import { cn } from "@/lib/utils";

// A conversation — the team's, or a private one with the manager — laid out
// the way a messaging app is: a scrolling column of bubbles, your own on the
// right, everyone else's on the left (in the group with their name above, in
// their own colour), and a composer pinned to the bottom.
//
// Messages arrive over an event stream, so one person sending is visible to
// everyone else without a refresh.

// A message on screen: saved, or one of ours still on its way.
type Message = ChatMessageView & { status?: "sending" | "failed" };

/** What the composer hands over to send. */
type Draft =
  | { kind: "TEXT"; body: string; projectId: string }
  | { kind: "IMAGE"; file: File; body: string; projectId: string }
  | { kind: "FILE"; file: File; body: string; projectId: string }
  | { kind: "VOICE"; blob: Blob; fileName: string; durationSeconds: number; projectId: string };

const NAME_COLOURS = [
  "text-cyan-strong",
  "text-purple-strong",
  "text-pink-strong",
  "text-orange-strong",
  "text-emerald-700",
];

/** Same person, same colour, every time — from the name itself. */
function nameColour(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return NAME_COLOURS[hash % NAME_COLOURS.length];
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
  canDeleteAny,
  projects,
  conversation,
  header,
  showNames = true,
  emptyText,
}: {
  initialMessages: Message[];
  viewerType: "ADMIN" | "EMPLOYEE";
  viewerId: string | null;
  canDeleteAny: boolean;
  projects: { id: string; name: string }[];
  /** Which conversation, as its URL names it: "team", or a private chat. */
  conversation: string;
  /** The WhatsApp-style header on top: the group's, or the person's. */
  header?: { name: string; subtitle: string; avatar?: string; backHref?: string };
  /** A private chat has two people in it, so its bubbles need no names. */
  showNames?: boolean;
  emptyText?: string;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  const newest = messages.at(-1)?.createdAt;

  const isMine = useCallback(
    (message: Pick<Message, "authorType" | "authorId">) =>
      message.authorType === viewerType && (viewerType === "ADMIN" || message.authorId === viewerId),
    [viewerType, viewerId]
  );

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

    // The browser reconnects on its own; the next connection carries the
    // cursor from whatever this one delivered.
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const dayHeadings = useMemo(
    () =>
      messages.map((message, index) => {
        const day = dayLabel(new Date(message.createdAt));
        const previous = index > 0 ? dayLabel(new Date(messages[index - 1].createdAt)) : null;
        return day === previous ? null : day;
      }),
    [messages]
  );

  return (
    <div className="flex h-full flex-col bg-[#efeae2]">
      {header && (
        <ChatHeader name={header.name} subtitle={header.subtitle} avatar={header.avatar} backHref={header.backHref} />
      )}
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-3 py-3"
        // The faint tile behind a chat, drawn rather than fetched.
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, rgba(21,19,31,0.035) 1px, transparent 1px), radial-gradient(circle at 70% 80%, rgba(21,19,31,0.03) 1px, transparent 1px)",
          backgroundSize: "56px 56px, 84px 84px",
        }}
      >
        {messages.length === 0 && (
          <p className="mt-12 text-center text-sm text-ink/40">
            {emptyText ?? "No messages yet. Send an update, a photo from site, or a voice note."}
          </p>
        )}

        {messages.map((message, index) => (
          <Bubble
            key={message.id}
            message={message}
            day={dayHeadings[index]}
            mine={isMine(message)}
            showName={showNames}
            canDelete={canDeleteAny}
            onDiscard={
              message.status
                ? () => setMessages((current) => current.filter((item) => item.id !== message.id))
                : undefined
            }
          />
        ))}

        <div ref={bottomRef} />
      </div>

      <Composer projects={projects} onSend={sendDraft} />
    </div>
  );
}

function Bubble({
  message,
  day,
  mine,
  showName,
  canDelete,
  onDiscard,
}: {
  message: Message;
  day: string | null;
  mine: boolean;
  /** In the group, whose message it is; in a private chat that goes without saying. */
  showName: boolean;
  canDelete: boolean;
  /** Removes one of our own copies that never made it. */
  onDiscard?: () => void;
}) {
  const [, startTransition] = useTransition();
  const isAgent = message.authorType === "AGENT";
  const created = new Date(message.createdAt);

  return (
    <>
      {day && (
        <div className="my-3 flex justify-center">
          <span className="rounded-lg bg-white/80 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-ink/45 shadow-sm">
            {day}
          </span>
        </div>
      )}

      <div className={cn("group/msg mb-1.5 flex", mine && !isAgent ? "justify-end" : "justify-start")}>
        <div
          className={cn(
            "relative max-w-[85%] rounded-xl px-2.5 py-1.5 shadow-sm sm:max-w-[70%]",
            isAgent
              ? "border border-purple/25 bg-purple/[0.08]"
              : mine
                ? "bg-[#d9fdd3]"
                : "bg-white"
          )}
        >
          {!mine && (showName || isAgent) && (
            <p className={cn("mb-0.5 text-[13px] font-semibold", isAgent ? "text-purple-strong" : nameColour(message.authorName))}>
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
            <VoiceNote url={message.attachmentUrl} seconds={message.durationSeconds} mine={mine} />
          )}

          {message.kind === "FILE" && message.attachmentUrl && (
            <a
              href={message.attachmentUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "mb-1 flex items-center gap-2 rounded-lg px-2 py-2 text-sm",
                mine ? "bg-black/5" : "bg-ink/5"
              )}
            >
              <FileText size={18} strokeWidth={1.75} className="shrink-0 text-ink/50" />
              <span className="min-w-0 flex-1 truncate">{message.attachmentName}</span>
            </a>
          )}

          {message.body && (
            <p className="whitespace-pre-wrap break-words pr-12 text-[15px] leading-snug text-ink">
              {message.body}
            </p>
          )}

          {/* Time tucked into the bottom-right of the bubble. */}
          <span className="pointer-events-none float-right -mb-0.5 ml-2 mt-1 inline-flex items-center gap-1 text-[11px] text-ink/40">
            {message.project && <span className="max-w-24 truncate">{message.project.name}</span>}
            {timeLabel(created)}
            {mine && !isAgent && message.status === "sending" && (
              <Clock size={12} strokeWidth={2} className="text-ink/40" aria-label="Sending" />
            )}
            {mine && !isAgent && message.status === "failed" && (
              <CircleAlert size={13} strokeWidth={2} className="text-red-500" aria-label="Not sent" />
            )}
            {mine && !isAgent && !message.status && (
              <CheckCheck size={13} strokeWidth={2} className="text-cyan-strong" aria-label="Sent" />
            )}
          </span>

          {message.status === "failed" && (
            <button type="button" onClick={onDiscard} className="mt-1 block text-[11px] font-medium text-red-600">
              Not sent · tap to remove
            </button>
          )}

          {(canDelete || mine) && !isAgent && !message.status && (
            <button
              type="button"
              onClick={() => {
                if (confirm("Delete this message?")) startTransition(() => deleteChatMessage(message.id));
              }}
              aria-label="Delete message"
              className={cn(
                "absolute -top-2 rounded-full bg-white p-1 text-ink/35 opacity-0 shadow transition-opacity",
                "hover:text-red-600 group-hover/msg:opacity-100",
                mine ? "-left-2" : "-right-2"
              )}
            >
              <Trash2 size={11} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/** A voice note: play, a scrubbable bar, and how long it runs. */
function VoiceNote({ url, seconds, mine }: { url: string; seconds: number | null; mine: boolean }) {
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
          mine ? "bg-emerald-600/15 text-emerald-700" : "bg-ink/5 text-ink/60"
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
        <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
          <div
            className={cn("h-full rounded-full transition-[width]", mine ? "bg-emerald-600/60" : "bg-cyan-strong/60")}
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-1 text-[11px] text-ink/40">
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
  onSend,
}: {
  projects: { id: string; name: string }[];
  onSend: (draft: Draft) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState("");
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

  function sendText() {
    const body = text.trim();
    if (!body) return;
    // Cleared at once: the message is already on screen, waiting for its tick.
    setText("");
    setShowAttach(false);
    setError(null);
    if (textRef.current) textRef.current.style.height = "auto";
    void onSend({ kind: "TEXT", body, projectId }).catch(fail);
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
    <div className="chat-composer select-none border-t border-ink/10 bg-[#f0f2f5] px-2 py-2">
      {error && <p className="px-2 pb-1.5 text-xs text-red-600">{error}</p>}
      {hint && !recording && <p className="px-2 pb-1.5 text-center text-xs text-ink/50">{hint}</p>}

      {showAttach && !recording && (
        <div className="mb-2 flex gap-2 px-1">
          <AttachButton label="Photo" onClick={() => photoRef.current?.click()}>
            <Camera size={18} strokeWidth={1.75} />
          </AttachButton>
          <AttachButton label="File" onClick={() => fileRef.current?.click()}>
            <Paperclip size={18} strokeWidth={1.75} />
          </AttachButton>
          {projects.length > 0 && (
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-ink/12 bg-white px-2 py-1.5 text-xs text-ink/70 outline-none"
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
          <div className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-full bg-white px-4">
            <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
            <span className="font-mono text-sm tabular-nums text-ink/70">{formatDuration(elapsed)}</span>
            <span
              className="flex flex-1 items-center justify-center gap-1 text-xs text-ink/45"
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
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink/45 hover:bg-ink/5"
            >
              <Plus size={22} strokeWidth={2} className={cn("transition-transform", showAttach && "rotate-45")} />
            </button>

            <div className="flex min-w-0 flex-1 items-end rounded-3xl bg-white px-3 py-1.5">
              <textarea
                ref={textRef}
                value={text}
                rows={1}
                dir="auto"
                placeholder="Message"
                onChange={(event) => {
                  setText(event.target.value);
                  // Grow with the text, like a messaging app, up to a limit.
                  const el = event.target;
                  el.style.height = "auto";
                  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendText();
                  }
                }}
                className="max-h-30 min-h-6 w-full select-text resize-none bg-transparent py-1 text-base outline-none"
              />
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                aria-label="Take a photo"
                className="mb-1 ml-2 shrink-0 text-ink/40 hover:text-ink"
              >
                <Camera size={20} strokeWidth={1.75} />
              </button>
            </div>
          </>
        )}

        {hasText && !recording ? (
          <button
            type="button"
            onClick={sendText}
            // Keeps the keyboard up after sending, as WhatsApp does.
            onMouseDown={(event) => event.preventDefault()}
            aria-label="Send"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white active:scale-95"
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
              "flex h-11 w-11 shrink-0 touch-none select-none items-center justify-center rounded-full bg-emerald-600 text-white transition-transform [-webkit-touch-callout:none]",
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
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-xl border border-ink/12 bg-white px-3 py-1.5 text-xs font-medium text-ink/70"
    >
      {children}
      {label}
    </button>
  );
}
