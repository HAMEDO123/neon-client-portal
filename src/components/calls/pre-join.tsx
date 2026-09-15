"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Phone, RefreshCw, Video, VideoOff, X } from "lucide-react";
import type { CallKind } from "@/lib/calls";
import {
  cameraConstraints,
  microphoneConstraints,
  openMedia,
  type MediaProblem,
} from "@/components/calls/call-session";
import { cn } from "@/lib/utils";

// The moment before a call: see yourself, hear that the microphone works,
// pick which microphone and camera, and choose to go in muted or with the
// camera off. The same devices are remembered on this device for next time.

export type PreJoinRequest =
  | { mode: "start"; conversation: string; kind: CallKind; title: string }
  | { mode: "join"; callId: string; kind: CallKind; title: string };

const DEVICES_KEY = "neon:call-devices";

/** The microphone and camera last picked on this device. */
export function savedDevices(): { micId: string | null; cameraId: string | null } {
  try {
    const value = JSON.parse(window.localStorage.getItem(DEVICES_KEY) ?? "{}") as { micId?: unknown; cameraId?: unknown };
    return {
      micId: typeof value.micId === "string" ? value.micId : null,
      cameraId: typeof value.cameraId === "string" ? value.cameraId : null,
    };
  } catch {
    return { micId: null, cameraId: null };
  }
}

function saveDevice(kind: "micId" | "cameraId", id: string) {
  try {
    window.localStorage.setItem(DEVICES_KEY, JSON.stringify({ ...savedDevices(), [kind]: id }));
  } catch {
    // Private browsing: the choice lasts as long as the page.
  }
}

const PROBLEM_TEXT: Record<MediaProblem, string> = {
  denied: "The microphone and camera are blocked for this site. Allow them in your browser's settings, then try again.",
  "no-microphone": "No microphone was found. You can still join and listen.",
  "no-camera": "The camera is not available. You can join with sound only.",
  unavailable: "This browser cannot make calls. Open the app in Safari or Chrome.",
};

export function PreJoin({
  request,
  inCall,
  onCancel,
  onConfirm,
}: {
  request: PreJoinRequest;
  inCall: boolean;
  onCancel: () => void;
  /** Starts or joins with these tracks; throws with a reason to show here. */
  onConfirm: (
    media: { mic: MediaStreamTrack | null; camera: MediaStreamTrack | null; audioMuted: boolean },
    problem: MediaProblem | null
  ) => Promise<void>;
}) {
  const ids = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const meterRef = useRef<HTMLSpanElement>(null);
  // The tracks this screen holds, stopped when it closes unless the call took them.
  const held = useRef<{ mic: MediaStreamTrack | null; camera: MediaStreamTrack | null; handedOver: boolean }>({
    mic: null,
    camera: null,
    handedOver: false,
  });

  const [mic, setMic] = useState<MediaStreamTrack | null>(null);
  const [camera, setCamera] = useState<MediaStreamTrack | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [problem, setProblem] = useState<MediaProblem | null>(null);
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const video = request.kind === "VIDEO";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    const state = held.current;
    return () => {
      if (dialog?.open) dialog.close();
      if (!state.handedOver) {
        state.mic?.stop();
        state.camera?.stop();
      }
    };
  }, []);

  // Asks for the devices when the screen opens, and again on "Try again".
  useEffect(() => {
    let alive = true;
    const saved = savedDevices();
    void openMedia({ video, micId: saved.micId, cameraId: saved.cameraId }).then(async (result) => {
      if (!alive) {
        result.mic?.stop();
        result.camera?.stop();
        return;
      }
      held.current.mic?.stop();
      held.current.camera?.stop();
      held.current.mic = result.mic;
      held.current.camera = result.camera;
      setMic(result.mic);
      setCamera(result.camera);
      setProblem(result.problem);
      setLoading(false);
      // Device names are only given once a permission has been granted.
      const list = (await navigator.mediaDevices?.enumerateDevices?.().catch(() => [])) ?? [];
      if (alive) setDevices(list);
    });
    return () => {
      alive = false;
    };
  }, [video, attempt]);

  useEffect(() => {
    const element = videoRef.current;
    if (element) element.srcObject = camera ? new MediaStream([camera]) : null;
  }, [camera]);

  // The microphone level, drawn straight onto the ring rather than through React.
  useEffect(() => {
    const ring = meterRef.current;
    if (!mic || !ring) return;
    const Context =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;

    const context = new Context();
    const source = context.createMediaStreamSource(new MediaStream([mic]));
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let frame = 0;
    let level = 0;

    const draw = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const value of data) sum += value * value;
      const rms = Math.sqrt(sum / data.length);
      level = rms > level ? rms : level * 0.85 + rms * 0.15;
      const scale = 1 + Math.min(level * 6, 0.6);
      ring.style.transform = `scale(${scale})`;
      ring.style.opacity = String(Math.min(level * 12, 1));
      frame = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void context.close().catch(() => undefined);
    };
  }, [mic]);

  async function switchCamera(on: boolean, deviceId?: string) {
    setError(null);
    if (!on) {
      held.current.camera?.stop();
      held.current.camera = null;
      setCamera(null);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(deviceId ?? savedDevices().cameraId) });
      const track = stream.getVideoTracks()[0];
      held.current.camera?.stop();
      held.current.camera = track;
      setCamera(track);
      if (deviceId) saveDevice("cameraId", deviceId);
      if (problem === "no-camera") setProblem(null);
    } catch {
      setError("The camera could not be started. Check that no other app is using it.");
    }
  }

  async function switchMicrophone(deviceId: string) {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(deviceId) });
      const track = stream.getAudioTracks()[0];
      held.current.mic?.stop();
      held.current.mic = track;
      setMic(track);
      saveDevice("micId", deviceId);
    } catch {
      setError("That microphone could not be used. Pick another one.");
    }
  }

  async function confirm() {
    setJoining(true);
    setError(null);
    held.current.handedOver = true;
    try {
      await onConfirm({ mic, camera, audioMuted: !micOn || !mic }, problem);
    } catch (cause) {
      held.current.handedOver = false;
      setError(cause instanceof Error ? cause.message : "Could not connect the call. Try again.");
      setJoining(false);
    }
  }

  const microphones = devices.filter((device) => device.kind === "audioinput" && device.deviceId);
  const cameras = devices.filter((device) => device.kind === "videoinput" && device.deviceId);
  const heading = request.mode === "start" ? `${video ? "Video call" : "Call"} ${request.title}` : `Join the call with ${request.title}`;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${ids}-heading`}
      onCancel={(event) => {
        event.preventDefault();
        if (!joining) onCancel();
      }}
      className="call-sheet m-auto w-[min(28rem,calc(100vw-1.5rem))] max-w-none overflow-hidden rounded-3xl border-0 bg-[#15131f] p-0 text-white shadow-2xl backdrop:bg-black/60"
    >
      <div className="flex max-h-[92dvh] flex-col overflow-y-auto">
        <header className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 id={`${ids}-heading`} className="min-w-0 truncate text-base font-semibold">
            {heading}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={joining}
            aria-label="Close"
            className="-mr-2 flex h-10 w-10 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <X size={19} />
          </button>
        </header>

        <div className="px-5">
          <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl bg-white/[0.06]">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              aria-label="Your camera"
              className={cn("absolute inset-0 h-full w-full -scale-x-100 object-cover transition-opacity duration-300", camera ? "opacity-100" : "opacity-0")}
            />
            {!camera && (
              <span className="relative flex h-20 w-20 items-center justify-center">
                <span ref={meterRef} aria-hidden className="absolute inset-0 rounded-full bg-emerald-400/40 opacity-0" />
                <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-white/10">
                  {micOn && mic ? <Mic size={28} aria-hidden /> : <MicOff size={28} aria-hidden className="text-white/60" />}
                </span>
              </span>
            )}
            {camera && (
              <span aria-hidden className="absolute bottom-3 left-3 flex h-8 w-8 items-center justify-center">
                <span ref={meterRef} className="absolute inset-0 rounded-full bg-emerald-400/50 opacity-0" />
                <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-black/50">
                  {micOn && mic ? <Mic size={15} /> : <MicOff size={15} className="text-white/60" />}
                </span>
              </span>
            )}
            {loading && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                <Loader2 size={26} className="animate-spin text-white/80" aria-label="Starting your devices" />
              </span>
            )}
          </div>

          {problem && !loading && (
            <div role="status" className="mt-3 flex items-start gap-3 rounded-2xl bg-amber-400/15 px-3 py-2.5 text-sm text-amber-100">
              <p className="flex-1">{PROBLEM_TEXT[problem]}</p>
              {problem === "denied" && (
                <button
                  type="button"
                  onClick={() => {
                    setLoading(true);
                    setAttempt((count) => count + 1);
                  }}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold hover:bg-white/25"
                >
                  <RefreshCw size={12} aria-hidden />
                  Try again
                </button>
              )}
            </div>
          )}

          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setMicOn(!micOn)}
              disabled={!mic}
              aria-pressed={!micOn}
              aria-label={micOn ? "Go in muted" : "Go in with the microphone on"}
              title={micOn ? "Mute" : "Unmute"}
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-full transition-[transform,background-color] active:scale-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
                micOn && mic ? "bg-white/15 hover:bg-white/25" : "bg-red-500 hover:bg-red-600"
              )}
            >
              {micOn && mic ? <Mic size={20} aria-hidden /> : <MicOff size={20} aria-hidden />}
            </button>
            <button
              type="button"
              onClick={() => void switchCamera(!camera)}
              aria-pressed={!camera}
              aria-label={camera ? "Go in with the camera off" : "Turn the camera on"}
              title={camera ? "Camera off" : "Camera on"}
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-full transition-[transform,background-color] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
                camera ? "bg-white/15 hover:bg-white/25" : "bg-white/[0.08] text-white/70 hover:bg-white/15"
              )}
            >
              {camera ? <Video size={20} aria-hidden /> : <VideoOff size={20} aria-hidden />}
            </button>
          </div>

          {(microphones.length > 0 || cameras.length > 0) && (
            <div className="mt-4 grid gap-2">
              {microphones.length > 0 && (
                <label className="flex items-center gap-2 text-xs text-white/55">
                  <Mic size={14} aria-hidden className="shrink-0" />
                  <span className="sr-only">Microphone</span>
                  <select
                    value={mic?.getSettings().deviceId ?? ""}
                    onChange={(event) => void switchMicrophone(event.target.value)}
                    className="h-9 min-w-0 flex-1 rounded-xl bg-white/10 px-2 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                  >
                    {microphones.map((device, index) => (
                      <option key={device.deviceId} value={device.deviceId} className="text-ink">
                        {device.label || `Microphone ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {cameras.length > 0 && (
                <label className="flex items-center gap-2 text-xs text-white/55">
                  <Video size={14} aria-hidden className="shrink-0" />
                  <span className="sr-only">Camera</span>
                  <select
                    value={camera?.getSettings().deviceId ?? ""}
                    onChange={(event) => void switchCamera(true, event.target.value)}
                    className="h-9 min-w-0 flex-1 rounded-xl bg-white/10 px-2 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                  >
                    {!camera && (
                      <option value="" className="text-ink">
                        Camera off
                      </option>
                    )}
                    {cameras.map((device, index) => (
                      <option key={device.deviceId} value={device.deviceId} className="text-ink">
                        {device.label || `Camera ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          {inCall && <p className="mt-3 text-center text-xs text-white/55">This ends the call you are in now.</p>}
          {error && (
            <p role="alert" className="mt-3 rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-100">
              {error}
            </p>
          )}
        </div>

        <footer className="mt-4 flex gap-2 px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onCancel}
            disabled={joining}
            className="h-12 flex-1 rounded-full bg-white/10 text-sm font-semibold transition-colors hover:bg-white/15 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={joining || loading || problem === "unavailable"}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-emerald-500 text-sm font-semibold transition-[transform,background-color] hover:bg-emerald-600 active:scale-[0.98] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#15131f]"
          >
            {joining ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Phone size={17} aria-hidden />}
            {joining ? "Connecting…" : request.mode === "start" ? "Start call" : "Join"}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
