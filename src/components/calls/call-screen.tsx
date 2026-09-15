"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  ChevronDown,
  LayoutGrid,
  Loader2,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  PhoneOff,
  Presentation,
  Send,
  Users,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import type { CallView } from "@/lib/call-store";
import { callDuration, gridFor, type Quality } from "@/lib/calls";
import type { ChatSide } from "@/lib/chat-conversations";
import { chatPreview } from "@/lib/notifications/types";
import { sendChatMessage } from "@/lib/actions/chat-actions";
import type { ChatMessageKind } from "@/generated/prisma/enums";
import { PersonAvatar } from "@/components/chat/person-avatar";
import type { CallSession, Person, SessionState } from "@/components/calls/call-session";
import { cn } from "@/lib/utils";

// The call on screen. Full screen by default: everybody in a grid that
// arranges itself for how many there are — or, with somebody sharing their
// screen or in speaker view, one large and the rest in a strip — with the
// controls along the bottom. Minimised, it becomes a small window that can be
// dragged to any corner and stays up while you use the rest of the app.
//
// Only opacity and transform animate. Keyboard: M mutes, V switches the
// camera, S shares the screen, Escape minimises.

type Tile = {
  id: string;
  name: string;
  /** Whose initials to draw when there is no picture: "You" is a label, not a name. */
  avatarName: string;
  color: string | null;
  track: MediaStreamTrack | null;
  screen: boolean;
  mine: boolean;
  audioMuted: boolean;
  speaking: boolean;
  quality: Quality;
  connection: Person["connection"] | "self";
};

function useTicker(intervalMs: number) {
  return useSyncExternalStore(
    (onChange) => {
      const timer = setInterval(onChange, intervalMs);
      return () => clearInterval(timer);
    },
    () => Math.floor(Date.now() / intervalMs),
    () => 0
  );
}

function useNarrow() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(max-width: 640px)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(max-width: 640px)").matches,
    () => false
  );
}

function canShareScreen() {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

const subscribeNothing = () => () => {};

export function CallScreen({
  session,
  call,
  me,
  side,
  view,
  onViewChange,
  notice,
  onDismissNotice,
}: {
  session: CallSession;
  call: CallView | undefined;
  me: string;
  side: ChatSide;
  view: "full" | "pip";
  onViewChange: (view: "full" | "pip") => void;
  notice: string | null;
  onDismissNotice: () => void;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const shareable = useSyncExternalStore(subscribeNothing, canShareScreen, () => false);
  const narrow = useNarrow();
  const second = useTicker(1000);

  const [layout, setLayout] = useState<"grid" | "speaker">("grid");
  const [panel, setPanel] = useState<"people" | "chat" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const mine = call?.participants.find((part) => part.memberKey === me);
  const invited = call?.participants.filter((part) => part.memberKey !== me && part.state === "INVITED") ?? [];
  const seconds = call?.answeredAt ? Math.max(0, second - Math.floor(new Date(call.answeredAt).getTime() / 1000)) : 0;

  const status =
    state.phase === "reconnecting"
      ? "Reconnecting…"
      : state.people.length === 0
        ? invited.length > 0
          ? "Ringing…"
          : "Waiting for others to join"
        : state.phase === "joining"
          ? "Connecting…"
          : callDuration(seconds);

  const toggleCamera = useCallback(() => {
    setProblem(null);
    session.setCamera(!session.getSnapshot().camera).catch(() => {
      setProblem("The camera could not be started. Check that it is allowed and not in use by another app.");
    });
  }, [session]);

  const toggleShare = useCallback(() => {
    setProblem(null);
    if (session.getSnapshot().screen) {
      void session.stopSharing();
      return;
    }
    session.startSharing().catch((error: unknown) => {
      // Closing the browser's picker is a choice, not a failure.
      if (error instanceof DOMException && error.name === "NotAllowedError") return;
      setProblem("The screen could not be shared.");
    });
  }, [session]);

  useEffect(() => {
    if (view !== "full") return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === "m") session.setMuted(!session.getSnapshot().audioMuted);
      else if (key === "v") toggleCamera();
      else if (key === "s" && canShareScreen()) toggleShare();
      else if (event.key === "Escape") {
        if (panel) setPanel(null);
        else onViewChange("pip");
      } else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, session, panel, onViewChange, toggleCamera, toggleShare]);

  const tiles = useMemo(() => buildTiles(state, me, mine), [state, me, mine]);
  const screenTile = tiles.find((tile) => tile.screen);
  const cameraTiles = tiles.filter((tile) => !tile.screen);
  const selfTile = cameraTiles.find((tile) => tile.mine)!;
  const others = cameraTiles.filter((tile) => !tile.mine);

  const spotlight =
    screenTile ??
    (layout === "speaker" && others.length > 0
      ? (others.find((tile) => tile.id === state.activeSpeaker) ?? others[0])
      : null);

  const shownNotice = problem ?? notice;
  const dismissNotice = () => {
    setProblem(null);
    onDismissNotice();
  };

  const audio = state.people.map((person) => <RemoteAudio key={person.key} track={person.audio} />);

  if (view === "pip") {
    const featured = screenTile ?? others.find((tile) => tile.id === state.activeSpeaker) ?? others[0] ?? selfTile;
    return (
      <>
        {audio}
        <PictureInPicture
          tile={featured}
          status={status}
          muted={state.audioMuted || !state.mic}
          onToggleMute={() => session.setMuted(!state.audioMuted)}
          onExpand={() => onViewChange("full")}
          onLeave={() => void session.leave()}
        />
      </>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Call with ${call?.title ?? "the others"}`}
      className="call-stage fixed inset-0 z-[60] flex flex-col bg-[#0e0d14] text-white"
    >
      {audio}

      <header className="flex shrink-0 items-center gap-3 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5">
        <button
          type="button"
          onClick={() => onViewChange("pip")}
          aria-label="Minimise the call"
          title="Minimise (Esc)"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <ChevronDown size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{call?.title ?? "Call"}</p>
          <p
            aria-live="polite"
            className={cn("text-xs tabular-nums", state.phase === "reconnecting" ? "text-amber-300" : "text-white/55")}
          >
            {status}
          </p>
        </div>
      </header>

      {shownNotice && (
        <div role="status" className="neon-rise mx-3 mb-2 flex items-start gap-3 rounded-2xl bg-amber-400/15 px-3 py-2 text-sm text-amber-100 sm:mx-5">
          <p className="flex-1">{shownNotice}</p>
          <button
            type="button"
            onClick={dismissNotice}
            aria-label="Dismiss"
            className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-amber-100/70 hover:bg-white/10 hover:text-white"
          >
            <X size={15} />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-3 px-3 sm:px-5">
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {others.length === 0 && !screenTile ? (
            <Waiting call={call} me={me} />
          ) : spotlight ? (
            <>
              <div className="min-h-0 flex-1">
                <TileView tile={spotlight} large />
              </div>
              <div className="flex h-24 shrink-0 gap-2 overflow-x-auto sm:h-28" aria-label="Everyone else">
                {cameraTiles
                  .filter((tile) => tile.id !== spotlight.id)
                  .map((tile) => (
                    <div key={tile.id} className="aspect-video h-full shrink-0">
                      <TileView tile={tile} />
                    </div>
                  ))}
              </div>
            </>
          ) : others.length === 1 ? (
            <div className="min-h-0 flex-1">
              <TileView tile={others[0]} large />
            </div>
          ) : (
            <Grid tiles={cameraTiles} narrow={narrow} />
          )}

          {/* Between two people, yourself floats in a corner over the other person, as on a phone call. */}
          {(others.length <= 1 || !!spotlight) && !(spotlight && !screenTile) && (
            <div className="absolute right-3 top-3 aspect-[3/4] w-24 sm:aspect-video sm:w-44">
              <TileView tile={selfTile} />
            </div>
          )}
        </main>

        {panel && (
          <aside
            className="neon-rise fixed inset-0 z-10 flex flex-col bg-[#15131f] pt-[env(safe-area-inset-top)] sm:static sm:z-auto sm:mb-3 sm:w-80 sm:rounded-2xl sm:pt-0"
            aria-label={panel === "people" ? "People in the call" : "Chat"}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <p className="text-sm font-semibold">{panel === "people" ? "People" : "Chat"}</p>
              <button
                type="button"
                onClick={() => setPanel(null)}
                aria-label="Close panel"
                className="-mr-2 flex h-9 w-9 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                <X size={17} />
              </button>
            </div>
            {panel === "people" ? (
              <PeoplePanel call={call} state={state} me={me} />
            ) : call ? (
              <CallChat conversation={call.conversationSlug} side={side} me={me} />
            ) : null}
          </aside>
        )}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-center gap-2 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:gap-3">
        <Control
          label={state.audioMuted || !state.mic ? "Unmute" : "Mute"}
          shortcut="M"
          off={state.audioMuted || !state.mic}
          disabled={!state.mic}
          onClick={() => session.setMuted(!state.audioMuted)}
        >
          {state.audioMuted || !state.mic ? <MicOff size={20} /> : <Mic size={20} />}
        </Control>
        <Control label={state.camera ? "Turn camera off" : "Turn camera on"} shortcut="V" off={!state.camera} onClick={toggleCamera}>
          {state.camera ? <Video size={20} /> : <VideoOff size={20} />}
        </Control>
        {shareable && (
          <Control label={state.screen ? "Stop sharing" : "Share your screen"} shortcut="S" active={Boolean(state.screen)} onClick={toggleShare}>
            {state.screen ? <MonitorX size={20} /> : <MonitorUp size={20} />}
          </Control>
        )}
        {others.length > 1 && !screenTile && (
          <Control
            label={layout === "grid" ? "Speaker view" : "Grid view"}
            active={layout === "speaker"}
            onClick={() => setLayout(layout === "grid" ? "speaker" : "grid")}
          >
            {layout === "grid" ? <Presentation size={20} /> : <LayoutGrid size={20} />}
          </Control>
        )}
        <Control label="People" active={panel === "people"} onClick={() => setPanel(panel === "people" ? null : "people")}>
          <Users size={20} />
        </Control>
        <Control label="Chat" active={panel === "chat"} onClick={() => setPanel(panel === "chat" ? null : "chat")}>
          <MessageSquare size={20} />
        </Control>
        <Control label="Minimise" onClick={() => onViewChange("pip")} className="hidden sm:flex">
          <ChevronDown size={20} />
        </Control>
        <Control label="Leave the call" danger onClick={() => void session.leave()}>
          <PhoneOff size={20} />
        </Control>
      </footer>
    </div>
  );
}

function buildTiles(state: SessionState, me: string, mine: { name: string; color: string | null } | undefined): Tile[] {
  const tiles: Tile[] = [
    {
      id: me,
      name: "You",
      avatarName: mine?.name ?? "You",
      color: mine?.color ?? null,
      track: state.camera,
      screen: false,
      mine: true,
      audioMuted: state.audioMuted || !state.mic,
      speaking: state.speaking,
      quality: "unknown",
      connection: "self",
    },
  ];
  if (state.screen) {
    tiles.push({ ...tiles[0], id: `${me}:screen`, name: "Your screen", track: state.screen, screen: true, speaking: false });
  }

  for (const person of state.people) {
    tiles.push({
      id: person.key,
      name: person.name,
      avatarName: person.name,
      color: person.color,
      track: person.videoOff ? null : person.camera,
      screen: false,
      mine: false,
      audioMuted: person.audioMuted,
      speaking: person.speaking,
      quality: person.quality,
      connection: person.connection,
    });
    if (person.sharing && person.screen) {
      tiles.push({
        id: `${person.key}:screen`,
        name: `${person.name}'s screen`,
        avatarName: person.name,
        color: person.color,
        track: person.screen,
        screen: true,
        mine: false,
        audioMuted: person.audioMuted,
        speaking: false,
        quality: person.quality,
        connection: person.connection,
      });
    }
  }
  return tiles;
}

function Grid({ tiles, narrow }: { tiles: Tile[]; narrow: boolean }) {
  const { columns, rows } = gridFor(tiles.length, narrow);
  return (
    <div
      className="grid min-h-0 flex-1 gap-2 sm:gap-3"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
    >
      {tiles.map((tile) => (
        <TileView key={tile.id} tile={tile} large={tiles.length <= 2} />
      ))}
    </div>
  );
}

function TileView({ tile, large = false, compact = false }: { tile: Tile; large?: boolean; compact?: boolean }) {
  const reconnecting = tile.connection === "reconnecting" || tile.connection === "connecting";
  return (
    <div
      className="call-tile relative h-full w-full overflow-hidden rounded-2xl bg-[#1d1b28]"
      data-speaking={tile.speaking}
      aria-label={`${tile.name}${tile.audioMuted ? ", muted" : ""}${tile.speaking ? ", speaking" : ""}`}
    >
      {tile.track ? (
        <VideoTrack track={tile.track} mirror={tile.mine && !tile.screen} contain={tile.screen} />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <PersonAvatar
            name={tile.avatarName}
            color={tile.color}
            size={compact ? 44 : large ? 112 : 56}
            // A dark face on the dark call background still needs an edge.
            className="ring-2 ring-white/15"
          />
        </div>
      )}

      {!compact && (
        <span className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium backdrop-blur">
          {tile.audioMuted && !tile.screen && <MicOff size={12} className="shrink-0 text-red-300" aria-label="Muted" />}
          <span className="truncate">{tile.name}</span>
        </span>
      )}

      {!tile.mine && !tile.screen && tile.quality !== "unknown" && !compact && (
        <QualityBars quality={tile.quality} className="absolute right-2 top-2" />
      )}

      {!tile.mine && reconnecting && (
        <span className="absolute inset-0 flex items-center justify-center gap-2 bg-black/45 text-xs font-medium">
          <Loader2 size={15} className="animate-spin" aria-hidden />
          {tile.connection === "connecting" ? "Connecting…" : "Reconnecting…"}
        </span>
      )}
    </div>
  );
}

function VideoTrack({ track, mirror, contain }: { track: MediaStreamTrack; mirror: boolean; contain: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = new MediaStream([track]);
    void element.play().catch(() => undefined);
  }, [track]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={cn("h-full w-full bg-black", contain ? "object-contain" : "object-cover", mirror && "-scale-x-100")}
    />
  );
}

function RemoteAudio({ track }: { track: MediaStreamTrack | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = track ? new MediaStream([track]) : null;
    if (track) void element.play().catch(() => undefined);
  }, [track]);
  return <audio ref={ref} autoPlay className="hidden" />;
}

function QualityBars({ quality, className }: { quality: Quality; className?: string }) {
  const bars = quality === "good" ? 3 : quality === "fair" ? 2 : 1;
  const colour = quality === "good" ? "bg-emerald-400" : quality === "fair" ? "bg-amber-300" : "bg-red-400";
  const label = quality === "good" ? "Good connection" : quality === "fair" ? "Unsteady connection" : "Poor connection";
  return (
    <span role="img" aria-label={label} title={label} className={cn("flex h-4 items-end gap-0.5 rounded-md bg-black/55 px-1 py-0.5", className)}>
      {[1, 2, 3].map((bar) => (
        <span key={bar} className={cn("w-1 rounded-sm", bar <= bars ? colour : "bg-white/25")} style={{ height: `${bar * 3 + 2}px` }} />
      ))}
    </span>
  );
}

function Waiting({ call, me }: { call: CallView | undefined; me: string }) {
  const asked = call?.participants.filter((part) => part.memberKey !== me) ?? [];
  const ringing = asked.some((part) => part.state === "INVITED");
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 text-center">
      <div className="flex -space-x-3">
        {asked.slice(0, 4).map((part) => (
          <span key={part.memberKey} className="relative flex rounded-full ring-4 ring-[#0e0d14]">
            {ringing && part.state === "INVITED" && <span aria-hidden className="call-pulse absolute inset-0 rounded-full" />}
            <PersonAvatar name={part.name} color={part.color} size={88} className="relative" />
          </span>
        ))}
      </div>
      <p className="max-w-xs text-sm text-white/60">
        {ringing ? `Calling ${asked.map((part) => part.name).join(", ")}…` : "Nobody else is in the call right now."}
      </p>
    </div>
  );
}

function Control({
  label,
  shortcut,
  onClick,
  children,
  off = false,
  active = false,
  danger = false,
  disabled = false,
  className,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  children: ReactNode;
  off?: boolean;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const tip = useId();
  return (
    <span className={cn("group relative flex", className)}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-describedby={tip}
        aria-keyshortcuts={shortcut}
        aria-pressed={danger ? undefined : active || off}
        className={cn(
          "flex h-12 items-center justify-center rounded-full transition-[transform,background-color,color] duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e0d14]",
          danger
            ? "w-16 bg-red-500 hover:bg-red-600"
            : off
              ? "w-12 bg-red-500/90 hover:bg-red-500"
              : active
                ? "w-12 bg-white text-[#0e0d14] hover:bg-white/90"
                : "w-12 bg-white/12 hover:bg-white/20"
        )}
      >
        {children}
      </button>
      <span
        id={tip}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-black/90 px-2 py-1 text-xs text-white opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:hidden"
      >
        {label}
        {shortcut && <kbd className="ml-1.5 font-sans text-white/55">{shortcut}</kbd>}
      </span>
    </span>
  );
}

function PeoplePanel({ call, state, me }: { call: CallView | undefined; state: SessionState; me: string }) {
  const parts = [...(call?.participants ?? [])].sort((a, b) => (a.memberKey === me ? -1 : b.memberKey === me ? 1 : 0));
  const label = { JOINED: "In the call", INVITED: "Not joined", DECLINED: "Declined", LEFT: "Left" } as const;

  return (
    <ul className="flex-1 overflow-y-auto p-2">
      {parts.map((part) => {
        const person = state.people.find((each) => each.key === part.memberKey);
        const muted = part.memberKey === me ? state.audioMuted || !state.mic : person?.audioMuted;
        return (
          <li key={part.memberKey} className="flex items-center gap-3 rounded-xl px-2 py-2">
            <PersonAvatar name={part.name} color={part.color} size={34} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{part.memberKey === me ? `${part.name} (you)` : part.name}</p>
              <p className="text-xs text-white/50">{label[part.state]}</p>
            </div>
            {part.state === "JOINED" &&
              (muted ? (
                <MicOff size={16} className="text-red-300" aria-label="Muted" />
              ) : (
                <Mic size={16} className="text-white/50" aria-label="Unmuted" />
              ))}
          </li>
        );
      })}
    </ul>
  );
}

type PanelMessage = {
  id: string;
  authorType: string;
  authorId: string | null;
  authorName: string;
  kind: ChatMessageKind;
  body: string | null;
  durationSeconds: number | null;
  attachmentName: string | null;
  managerOnly: boolean;
  createdAt: string;
};

/** The conversation's messages from the last hour and as they arrive, with a box to write in. */
function CallChat({ conversation, side, me }: { conversation: string; side: ChatSide; me: string }) {
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    const source = new EventSource(
      `/api/chat/stream?as=${side}&with=${encodeURIComponent(conversation)}&since=${encodeURIComponent(since)}`
    );
    source.addEventListener("messages", (event) => {
      const incoming = (JSON.parse((event as MessageEvent).data) as PanelMessage[]).filter((message) => !message.managerOnly);
      setMessages((current) => {
        const known = new Set(current.map((message) => message.id));
        return [...current, ...incoming.filter((message) => !known.has(message.id))].slice(-100);
      });
    });
    return () => source.close();
  }, [conversation, side]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  const mine = (message: PanelMessage) =>
    side === "ADMIN" ? message.authorType === "ADMIN" : message.authorType === "EMPLOYEE" && message.authorId === me;

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setDraft("");
    setSending(true);
    setError(null);
    const formData = new FormData();
    formData.set("conversation", conversation);
    formData.set("as", side);
    formData.set("body", body);
    try {
      const saved = await sendChatMessage(formData);
      if (saved) {
        const arrived: PanelMessage = { ...saved, createdAt: new Date(saved.createdAt).toISOString() };
        setMessages((current) => (current.some((message) => message.id === arrived.id) ? current : [...current, arrived]));
      }
    } catch {
      setError("Not sent. Try again.");
      setDraft(body);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ol ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-3" aria-label="Messages">
        {messages.length === 0 && <li className="py-8 text-center text-sm text-white/40">No messages in the last hour.</li>}
        {messages.map((message) => (
          <li key={message.id} className={cn("flex flex-col", mine(message) ? "items-end" : "items-start")}>
            {!mine(message) && <span className="mb-0.5 px-1 text-[11px] text-white/45">{message.authorName}</span>}
            <span
              dir="auto"
              className={cn(
                "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-sm",
                mine(message) ? "bg-emerald-600" : "bg-white/10"
              )}
            >
              {chatPreview(message.kind, message.body, message.durationSeconds, message.attachmentName)}
            </span>
          </li>
        ))}
      </ol>
      {error && <p className="px-3 text-xs text-red-300">{error}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="flex items-center gap-2 border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3"
      >
        <label className="sr-only" htmlFor={`call-chat-${conversation}`}>
          Message
        </label>
        <input
          id={`call-chat-${conversation}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          dir="auto"
          placeholder="Message"
          maxLength={4000}
          className="h-10 min-w-0 flex-1 rounded-full bg-white/10 px-4 text-sm text-white outline-none placeholder:text-white/40 focus-visible:ring-2 focus-visible:ring-white/50"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          aria-label="Send"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 transition-[transform,opacity] active:scale-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </form>
    </div>
  );
}

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * The call, small, over the rest of the app: dragged anywhere and let go, it
 * settles into the nearest corner. It keeps the call's sound going while you
 * read a task or answer a message.
 */
function PictureInPicture({
  tile,
  status,
  muted,
  onToggleMute,
  onExpand,
  onLeave,
}: {
  tile: Tile;
  status: string;
  muted: boolean;
  onToggleMute: () => void;
  onExpand: () => void;
  onLeave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [corner, setCorner] = useState<Corner>("bottom-right");
  const drag = useRef<{ pointer: number; startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null);
  const position = useRef({ x: 0, y: 0 });

  const place = useCallback(
    (animate: boolean) => {
      const element = ref.current;
      if (!element) return;
      const margin = 12;
      const x = corner.endsWith("left") ? margin : window.innerWidth - element.offsetWidth - margin;
      // Clear of the portal's tab bar and a chat's message box.
      const y = corner.startsWith("top") ? margin + 44 : window.innerHeight - element.offsetHeight - margin - 76;
      position.current = { x, y };
      element.style.transition = animate ? "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 150ms" : "none";
      element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      element.style.opacity = "1";
    },
    [corner]
  );

  useEffect(() => {
    place(true);
    const onResize = () => place(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [place]);

  return (
    <div
      ref={ref}
      role="region"
      aria-label={`Call, minimised. ${status}`}
      className="fixed left-0 top-0 z-[65] w-40 overflow-hidden rounded-2xl bg-[#15131f] text-white opacity-0 shadow-2xl ring-1 ring-white/10 sm:w-60"
    >
      <div
        className="relative aspect-[3/4] cursor-grab touch-none select-none active:cursor-grabbing sm:aspect-video"
        onPointerDown={(event) => {
          const element = ref.current;
          if (!element) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointer: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            x: position.current.x,
            y: position.current.y,
            moved: false,
          };
          element.style.transition = "none";
        }}
        onPointerMove={(event) => {
          const moving = drag.current;
          const element = ref.current;
          if (!moving || !element || moving.pointer !== event.pointerId) return;
          const dx = event.clientX - moving.startX;
          const dy = event.clientY - moving.startY;
          if (Math.abs(dx) + Math.abs(dy) > 4) moving.moved = true;
          element.style.transform = `translate3d(${moving.x + dx}px, ${moving.y + dy}px, 0)`;
        }}
        onPointerUp={(event) => {
          const moving = drag.current;
          drag.current = null;
          if (!moving) return;
          if (!moving.moved) {
            onExpand();
            return;
          }
          const next: Corner = `${event.clientY < window.innerHeight / 2 ? "top" : "bottom"}-${event.clientX < window.innerWidth / 2 ? "left" : "right"}`;
          if (next === corner) place(true);
          else setCorner(next);
        }}
        onPointerCancel={() => {
          drag.current = null;
          place(true);
        }}
      >
        <TileView tile={tile} compact />
        <span className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent px-2 pb-4 pt-1.5 text-[11px] font-medium tabular-nums">
          {status}
        </span>
      </div>
      <div className="flex items-center justify-between gap-1 p-1.5">
        <PipButton label={muted ? "Unmute" : "Mute"} off={muted} onClick={onToggleMute}>
          {muted ? <MicOff size={16} /> : <Mic size={16} />}
        </PipButton>
        <PipButton label="Back to the call" onClick={onExpand}>
          <Maximize2 size={16} />
        </PipButton>
        <PipButton label="Leave the call" danger onClick={onLeave}>
          <PhoneOff size={16} />
        </PipButton>
      </div>
    </div>
  );
}

function PipButton({
  label,
  onClick,
  children,
  off = false,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  off?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-9 flex-1 items-center justify-center rounded-full transition-[transform,background-color] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
        danger ? "bg-red-500 hover:bg-red-600" : off ? "bg-red-500/90 hover:bg-red-500" : "bg-white/12 hover:bg-white/20"
      )}
    >
      {children}
    </button>
  );
}
