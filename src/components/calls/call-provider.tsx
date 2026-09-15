"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { CallView } from "@/lib/call-store";
import type { CallKind, IceServer } from "@/lib/calls";
import type { ChatSide } from "@/lib/chat-conversations";
import { startRingtone, unlockSounds } from "@/lib/sound-cues";
import { CallSession, openMedia, type MediaProblem } from "@/components/calls/call-session";
import { IncomingCall } from "@/components/calls/incoming-call";
import { PreJoin, savedDevices, type PreJoinRequest } from "@/components/calls/pre-join";
import { CallScreen } from "@/components/calls/call-screen";

// Calls, everywhere in a portal. Mounted once in each portal's shell, so a
// call rings on any page, and a call in progress stays up — full screen or in
// its small floating window — while you move between pages.
//
// It holds the calls stream open, rings for incoming calls, shows the screen
// before a call (devices, and whether to go in muted), and runs the call
// itself (CallSession). Chat screens reach it through useCalls.

type Ready = { me: string; name: string; iceServers: IceServer[]; relay: boolean };

type CallsContext = {
  me: string | null;
  calls: CallView[];
  activeCallId: string | null;
  /** Opens the screen before a call: which devices, and whether to go in muted. */
  prepare: (request: PreJoinRequest) => void;
  /** Brings the call in progress back to full screen. */
  expand: () => void;
};

const Context = createContext<CallsContext | null>(null);

/** The calls in this portal, or null outside one. */
export function useCalls() {
  return useContext(Context);
}

export const MEDIA_PROBLEM_TEXT: Record<MediaProblem, string> = {
  denied: "The microphone is blocked for this site, so the others cannot hear you. Allow it in the browser's settings.",
  "no-microphone": "No microphone was found, so the others cannot hear you.",
  "no-camera": "The camera is not available, so the others see your initials instead.",
  unavailable: "This browser cannot make calls. Open the app in Safari or Chrome.",
};

const subscribeNothing = () => () => {};

type Media = { mic: MediaStreamTrack | null; camera: MediaStreamTrack | null; audioMuted: boolean };

export function CallProvider({ side, children }: { side: ChatSide; children: ReactNode }) {
  // Portals need a document, which the server does not have.
  const client = useSyncExternalStore(subscribeNothing, () => true, () => false);

  const [ready, setReady] = useState<Ready | null>(null);
  const [calls, setCalls] = useState<CallView[]>([]);
  const [session, setSession] = useState<CallSession | null>(null);
  const [view, setView] = useState<"full" | "pip">("full");
  const [prejoin, setPrejoin] = useState<PreJoinRequest | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);
  const sessionRef = useRef<CallSession | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    const source = new EventSource(`/api/calls/stream?as=${side}`);
    source.addEventListener("ready", (event) => setReady(JSON.parse((event as MessageEvent).data) as Ready));
    source.addEventListener("calls", (event) => setCalls(JSON.parse((event as MessageEvent).data) as CallView[]));
    source.addEventListener("signals", (event) => {
      sessionRef.current?.receive(JSON.parse((event as MessageEvent).data));
    });
    return () => source.close();
  }, [side]);

  // The call on screen follows what the server says about it.
  const activeCall = session ? calls.find((call) => call.id === session.callId) : undefined;
  useEffect(() => {
    session?.sync(activeCall);
  }, [session, activeCall]);

  const me = ready?.me ?? null;
  const ringing = calls.find(
    (call) =>
      call.id !== session?.callId &&
      call.status !== "ENDED" &&
      !dismissed.includes(call.id) &&
      call.participants.some((part) => part.memberKey === me && part.state === "INVITED")
  );
  const ringingId = ringing?.id ?? null;

  useEffect(() => {
    if (!ringingId) return;
    return startRingtone();
  }, [ringingId]);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, as: side }),
      });
      const data = (await response.json().catch(() => ({}))) as { callId?: string; iceServers?: IceServer[]; error?: string };
      return { ok: response.ok, ...data };
    },
    [side]
  );

  /** Starts or joins, and puts the call on screen. Throws with a reason a person can read. */
  const begin = useCallback(
    async (request: PreJoinRequest, media: Media, problem: MediaProblem | null) => {
      if (!ready) throw new Error("Calls are still connecting. Try again in a moment.");

      // One call at a time.
      const current = sessionRef.current;
      if (current) await current.leave();

      const answer =
        request.mode === "start"
          ? await post({ action: "start", conversation: request.conversation, kind: request.kind })
          : await post({ action: "join", callId: request.callId });
      if (!answer.ok || !answer.callId) throw new Error(answer.error ?? "Could not connect the call. Try again.");

      const next: CallSession = new CallSession({
        callId: answer.callId,
        me: ready.me,
        side,
        iceServers: answer.iceServers ?? ready.iceServers,
        mic: media.mic,
        camera: media.camera,
        audioMuted: media.audioMuted,
        onEnded: (reason) => {
          setSession((shown) => (shown === next ? null : shown));
          setView("full");
          if (reason) setNotice(reason);
        },
      });
      next.start();
      setSession(next);
      setView("full");
      setNotice(problem ? MEDIA_PROBLEM_TEXT[problem] : null);
    },
    [post, ready, side]
  );

  async function accept(call: CallView, video: boolean) {
    void unlockSounds();
    setAnswering(true);
    setDismissed((current) => [...current, call.id]);
    const saved = savedDevices();
    const media = await openMedia({ video, micId: saved.micId, cameraId: saved.cameraId });
    try {
      await begin(
        { mode: "join", callId: call.id, kind: call.kind, title: call.title },
        { mic: media.mic, camera: media.camera, audioMuted: false },
        media.problem
      );
    } catch (cause) {
      media.mic?.stop();
      media.camera?.stop();
      setNotice(cause instanceof Error ? cause.message : "Could not answer the call.");
    } finally {
      setAnswering(false);
    }
  }

  function decline(call: CallView) {
    setDismissed((current) => [...current, call.id]);
    void post({ action: "decline", callId: call.id }).catch(() => undefined);
  }

  const value = useMemo<CallsContext>(
    () => ({
      me,
      calls,
      activeCallId: session?.callId ?? null,
      prepare: (request) => {
        void unlockSounds();
        setPrejoin(request);
      },
      expand: () => setView("full"),
    }),
    [me, calls, session]
  );

  return (
    <Context.Provider value={value}>
      {children}
      {client &&
        createPortal(
          <>
            {ringing && me && (
              <IncomingCall
                call={ringing}
                inCall={Boolean(session)}
                answering={answering}
                onAccept={(video) => void accept(ringing, video)}
                onDecline={() => decline(ringing)}
              />
            )}
            {prejoin && (
              <PreJoin
                request={prejoin}
                inCall={Boolean(session)}
                onCancel={() => setPrejoin(null)}
                onConfirm={async (media, problem) => {
                  await begin(prejoin, media, problem);
                  setPrejoin(null);
                }}
              />
            )}
            {session && me && (
              <CallScreen
                session={session}
                call={activeCall}
                me={me}
                side={side}
                view={view}
                onViewChange={setView}
                notice={notice}
                onDismissNotice={() => setNotice(null)}
              />
            )}
            {!session && notice && (
              <div
                role="status"
                className="neon-rise fixed inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[70] mx-auto flex max-w-sm items-start gap-3 rounded-2xl bg-[#15131f] px-4 py-3 text-sm text-white shadow-2xl"
              >
                <p className="flex-1">{notice}</p>
                <button
                  type="button"
                  onClick={() => setNotice(null)}
                  aria-label="Dismiss"
                  className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
                >
                  <X size={15} />
                </button>
              </div>
            )}
          </>,
          document.body
        )}
    </Context.Provider>
  );
}

export type { CallKind };
