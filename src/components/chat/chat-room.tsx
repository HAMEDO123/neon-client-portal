"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Bot,
  Camera,
  CheckCheck,
  FileText,
  Mic,
  Paperclip,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { deleteChatMessage, sendChatMessage } from "@/lib/actions/chat-actions";
import type { ChatMessageView } from "@/lib/chat";
import { cn } from "@/lib/utils";

// The team conversation, laid out the way a messaging app is: a scrolling
// column of bubbles, your own on the right, everyone else's on the left with
// their name above in their own colour, and a composer pinned to the bottom.
//
// Messages arrive over an event stream, so one person sending is visible to
// everyone else without a refresh.

type Message = ChatMessageView;

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
}: {
  initialMessages: Message[];
  viewerType: "ADMIN" | "EMPLOYEE";
  viewerId: string | null;
  canDeleteAny: boolean;
  projects: { id: string; name: string }[];
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  const newest = messages.at(-1)?.createdAt;

  // --- live updates --------------------------------------------------------
  useEffect(() => {
    const since = newest ? new Date(newest).toISOString() : new Date().toISOString();
    const source = new EventSource(`/api/chat/stream?since=${encodeURIComponent(since)}`);

    source.addEventListener("messages", (event) => {
      const incoming = JSON.parse((event as MessageEvent).data) as (Omit<Message, "createdAt"> & {
        createdAt: string;
      })[];

      setMessages((current) => {
        const seen = new Set(current.map((message) => message.id));
        const added = incoming
          .filter((message) => !seen.has(message.id))
          .map((message) => ({ ...message, createdAt: new Date(message.createdAt) }) as Message);
        return added.length ? [...current, ...added] : current;
      });
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
            No messages yet. Send an update, a photo from site, or a voice note.
          </p>
        )}

        {messages.map((message, index) => (
          <Bubble
            key={message.id}
            message={message}
            day={dayHeadings[index]}
            mine={
              message.authorType === viewerType &&
              (viewerType === "ADMIN" ? true : message.authorId === viewerId)
            }
            canDelete={canDeleteAny}
          />
        ))}

        <div ref={bottomRef} />
      </div>

      <Composer projects={projects} />
    </div>
  );
}

function Bubble({
  message,
  day,
  mine,
  canDelete,
}: {
  message: Message;
  day: string | null;
  mine: boolean;
  canDelete: boolean;
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
          {!mine && (
            <p className={cn("mb-0.5 text-[13px] font-semibold", isAgent ? "text-purple-strong" : nameColour(message.authorName))}>
              {isAgent && <Bot size={12} strokeWidth={2.5} className="mr-1 inline" />}
              {message.authorName}
              {message.authorType === "ADMIN" && message.authorName !== "Manager" && " · Manager"}
            </p>
          )}

          {message.kind === "IMAGE" && message.attachmentUrl && (
            <a href={message.attachmentUrl} target="_blank" rel="noreferrer" className="mb-1 block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={message.attachmentUrl}
                alt={message.attachmentName ?? "Photo"}
                className="max-h-80 w-full rounded-lg object-cover"
              />
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
            {mine && !isAgent && <CheckCheck size={13} strokeWidth={2} className="text-cyan-strong" />}
          </span>

          {(canDelete || mine) && !isAgent && (
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

function Composer({ projects }: { projects: { id: string; name: string }[] }) {
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState("");
  const [showAttach, setShowAttach] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelled = useRef(false);

  const photoRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function send(extra?: (formData: FormData) => void) {
    const formData = new FormData();
    formData.set("body", text);
    if (projectId) formData.set("projectId", projectId);
    extra?.(formData);

    startTransition(async () => {
      try {
        await sendChatMessage(formData);
        setText("");
        setShowAttach(false);
        if (textRef.current) textRef.current.style.height = "auto";
      } catch (sendError) {
        setError(sendError instanceof Error ? sendError.message : "Could not send that.");
      }
    });
  }

  // Hold the mic to record, let go to send — a slide away or the X cancels.
  async function startRecording() {
    setError(null);
    cancelled.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);
      chunks.current = [];

      media.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };

      media.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const held = seconds;
        setRecording(false);
        setSeconds(0);

        // A tap that never became a recording is not a message.
        if (cancelled.current || chunks.current.length === 0 || held < 1) return;

        const blob = new Blob(chunks.current, { type: media.mimeType || "audio/webm" });
        send((formData) => {
          formData.set("voice", blob, `voice-${Date.now()}.webm`);
          formData.set("durationSeconds", String(held));
        });
      };

      media.start();
      recorder.current = media;
      setRecording(true);
      setSeconds(0);
      timer.current = setInterval(() => setSeconds((value) => value + 1), 1000);
    } catch {
      setError("Could not use the microphone — check permission.");
    }
  }

  function stopRecording(cancel = false) {
    cancelled.current = cancel;
    if (timer.current) clearInterval(timer.current);
    recorder.current?.stop();
  }

  return (
    <div className="chat-composer border-t border-ink/10 bg-[#f0f2f5] px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {error && <p className="px-2 pb-1.5 text-xs text-red-600">{error}</p>}

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
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) send((formData) => formData.set("photo", file));
          event.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) send((formData) => formData.set("photo", file));
          event.target.value = "";
        }}
      />
      <input
        ref={fileRef}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) send((formData) => formData.set("document", file));
          event.target.value = "";
        }}
      />

      {recording ? (
        <div className="flex items-center gap-3 rounded-full bg-white px-4 py-2.5">
          <button
            type="button"
            onClick={() => stopRecording(true)}
            aria-label="Cancel recording"
            className="text-ink/40 hover:text-red-600"
          >
            <Trash2 size={18} strokeWidth={1.75} />
          </button>
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          <span className="font-mono text-sm text-ink/70">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </span>
          <span className="flex-1 text-xs text-ink/35">Release to send</span>
          <button
            type="button"
            onClick={() => stopRecording(false)}
            aria-label="Send recording"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-white"
          >
            <Send size={16} strokeWidth={2} />
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-1.5">
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
                  if (text.trim()) send();
                }
              }}
              className="max-h-30 min-h-6 w-full resize-none bg-transparent py-1 text-base outline-none"
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

          {text.trim() ? (
            <button
              type="button"
              onClick={() => send()}
              disabled={pending}
              aria-label="Send"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white disabled:opacity-50"
            >
              <Send size={18} strokeWidth={2} />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Hold to record a voice message"
              onPointerDown={startRecording}
              onPointerUp={() => stopRecording(false)}
              onPointerLeave={() => recording && stopRecording(true)}
              disabled={pending}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white disabled:opacity-50"
            >
              <Mic size={19} strokeWidth={2} />
            </button>
          )}
        </div>
      )}
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
