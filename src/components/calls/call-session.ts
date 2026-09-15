import {
  HEARTBEAT_MS,
  initiates,
  isPolite,
  isSpeaking,
  nextSpeaker,
  qualityOf,
  type IceServer,
  type Quality,
} from "@/lib/calls";
import type { CallView } from "@/lib/call-store";
import { playCallSound } from "@/lib/sound-cues";

// One call, on this device: its microphone, camera and screen, a connection
// to each other person in the call, and everything the call screen shows —
// who is speaking, who is muted, how good each connection is.
//
// The sound and pictures go straight between devices (WebRTC, a connection per
// pair). The server only passes the messages two devices need to find each
// other, through /api/calls/signal and the calls stream.
//
// How two devices connect, in short:
// - whoever joined later offers to those already there (initiates); the
//   other creates its side when the offer arrives;
// - if both renegotiate at once, the polite one yields ("perfect negotiation",
//   isPolite), so a camera switched on at the same moment as a screen share
//   never deadlocks;
// - microphone, camera and screen each have their own transceiver, so turning
//   the camera off and on again is a track swap, not a renegotiation;
// - a small data channel carries the state the other side draws: muted,
//   camera off, sharing, and which transceiver is the camera and which the
//   screen;
// - a connection that drops restarts its ICE, and a device that the server
//   counted as gone joins the call again on its next heartbeat.
//
// Not React: the screen reads it through subscribe/getSnapshot.

type Side = "ADMIN" | "EMPLOYEE";
type Role = "audio" | "camera" | "screen" | "receive";
type Connection = "connecting" | "connected" | "reconnecting";

export type Person = {
  key: string;
  name: string;
  color: string | null;
  audio: MediaStreamTrack | null;
  camera: MediaStreamTrack | null;
  screen: MediaStreamTrack | null;
  audioMuted: boolean;
  videoOff: boolean;
  sharing: boolean;
  speaking: boolean;
  quality: Quality;
  connection: Connection;
};

export type SessionState = {
  callId: string;
  phase: "joining" | "live" | "reconnecting" | "ended";
  problem: string | null;
  mic: MediaStreamTrack | null;
  camera: MediaStreamTrack | null;
  screen: MediaStreamTrack | null;
  audioMuted: boolean;
  videoOff: boolean;
  sharing: boolean;
  speaking: boolean;
  activeSpeaker: string | null;
  people: Person[];
};

type RemoteState = {
  audioMuted: boolean;
  videoOff: boolean;
  sharing: boolean;
  mids: { camera: string | null; screen: string | null };
};

type Peer = {
  key: string;
  /** When they joined: a different value in their messages means they rejoined, and this connection is stale. */
  session: number;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  channel: RTCDataChannel;
  pending: RTCIceCandidateInit[];
  roles: Map<RTCRtpTransceiver, Role>;
  remote: RemoteState;
  quality: Quality;
  lastPackets: { lost: number; received: number } | null;
  connection: Connection;
  restart: ReturnType<typeof setTimeout> | undefined;
  /** Messages from this person are handled one after another, never interleaved. */
  queue: Promise<void>;
};

type Signal = { id: number; callId: string; fromKey: string; type: string; payload: unknown };
type Payload = { session?: number; description?: RTCSessionDescriptionInit; candidates?: RTCIceCandidateInit[] };

export type SessionOptions = {
  callId: string;
  me: string;
  side: Side;
  iceServers: IceServer[];
  mic: MediaStreamTrack | null;
  camera: MediaStreamTrack | null;
  audioMuted: boolean;
  /** Something that should close the call screen: the call ended, or this device was refused a way back in. */
  onEnded: (problem: string | null) => void;
};

const QUIET: RemoteState = { audioMuted: false, videoOff: true, sharing: false, mids: { camera: null, screen: null } };

export function microphoneConstraints(deviceId?: string | null): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
}

export function cameraConstraints(deviceId?: string | null): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" }),
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 24, max: 30 },
  };
}

export class CallSession {
  readonly callId: string;
  private readonly me: string;
  private readonly side: Side;
  private readonly iceServers: IceServer[];
  private readonly onEnded: SessionOptions["onEnded"];

  private mic: MediaStreamTrack | null;
  private camera: MediaStreamTrack | null;
  private screen: MediaStreamTrack | null = null;
  private audioMuted: boolean;
  private phase: SessionState["phase"] = "joining";
  private problem: string | null = null;

  private mySession = 0;
  /** Whether the server's list has shown this call yet. */
  private seen = false;
  private readonly peers = new Map<string, Peer>();
  private readonly people = new Map<string, { name: string; color: string | null; joined: boolean }>();

  private outbox: { to: string; type: "description" | "candidates"; payload: Payload }[] = [];
  private readonly candidates = new Map<string, RTCIceCandidateInit[]>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private flushing = false;

  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private audioContext: AudioContext | null = null;
  private readonly meters = new Map<
    string,
    { track: MediaStreamTrack; source: MediaStreamAudioSourceNode; analyser: AnalyserNode; data: Float32Array<ArrayBuffer>; level: number; speaking: boolean }
  >();
  private speaker: { key: string | null; since: number } = { key: null, since: 0 };

  private readonly listeners = new Set<() => void>();
  private snapshot: SessionState;

  constructor(options: SessionOptions) {
    this.callId = options.callId;
    this.me = options.me;
    this.side = options.side;
    this.iceServers = options.iceServers;
    this.onEnded = options.onEnded;
    this.mic = options.mic;
    this.camera = options.camera;
    this.audioMuted = options.audioMuted;
    if (this.mic) this.mic.enabled = !this.audioMuted;
    this.snapshot = this.build();
  }

  // --- for the screen -----------------------------------------------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private emit() {
    this.snapshot = this.build();
    for (const listener of this.listeners) listener();
  }

  private build(): SessionState {
    const people: Person[] = [];
    for (const [key, person] of this.people) {
      if (key === this.me || !person.joined) continue;
      const peer = this.peers.get(key);
      const transceivers = peer?.pc.getTransceivers() ?? [];
      const byMid = (mid: string | null) => (mid ? transceivers.find((t) => t.mid === mid)?.receiver.track ?? null : null);
      const firstVideo = transceivers.find((t) => t.receiver.track.kind === "video")?.receiver.track ?? null;
      const remote = peer?.remote ?? QUIET;

      people.push({
        key,
        name: person.name,
        color: person.color,
        audio: transceivers.find((t) => t.receiver.track.kind === "audio")?.receiver.track ?? null,
        camera: byMid(remote.mids.camera) ?? (remote.mids.camera ? null : firstVideo),
        screen: remote.sharing ? byMid(remote.mids.screen) : null,
        audioMuted: remote.audioMuted,
        videoOff: remote.videoOff,
        sharing: remote.sharing,
        speaking: this.meters.get(key)?.speaking ?? false,
        quality: peer?.quality ?? "unknown",
        connection: peer?.connection ?? "connecting",
      });
    }

    return {
      callId: this.callId,
      phase: this.phase,
      problem: this.problem,
      mic: this.mic,
      camera: this.camera,
      screen: this.screen,
      audioMuted: this.audioMuted,
      videoOff: !this.camera,
      sharing: Boolean(this.screen),
      speaking: this.meters.get(this.me)?.speaking ?? false,
      activeSpeaker: this.speaker.key,
      people,
    };
  }

  // --- life -----------------------------------------------------------------

  start() {
    this.timers.push(setInterval(() => void this.beat(), HEARTBEAT_MS));
    this.timers.push(setInterval(() => void this.sampleStats(), 2000));
    this.timers.push(setInterval(() => this.sampleLevels(), 120));
    window.addEventListener("pagehide", this.onPageHide);
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    this.meter(this.me, this.mic);
    this.emit();
  }

  /** Hanging up. */
  async leave() {
    if (this.phase === "ended") return;
    void this.post({ action: "leave" }, true);
    this.teardown();
    this.onEnded(null);
  }

  private end(problem: string | null) {
    if (this.phase === "ended") return;
    this.teardown();
    this.onEnded(problem);
  }

  private teardown() {
    this.phase = "ended";
    for (const timer of this.timers) clearInterval(timer);
    clearTimeout(this.flushTimer);
    window.removeEventListener("pagehide", this.onPageHide);
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    for (const key of [...this.peers.keys()]) this.closePeer(key, false);
    for (const track of [this.mic, this.camera, this.screen]) track?.stop();
    for (const meter of this.meters.values()) meter.source.disconnect();
    this.meters.clear();
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.emit();
  }

  // A closing tab cannot wait for a fetch; a beacon still goes.
  private onPageHide = () => {
    if (this.phase === "ended") return;
    const body = new Blob([JSON.stringify({ action: "leave", as: this.side, callId: this.callId })], { type: "text/plain" });
    navigator.sendBeacon("/api/calls", body);
  };

  private onOffline = () => {
    if (this.phase === "ended") return;
    this.phase = "reconnecting";
    this.emit();
  };

  private onOnline = () => {
    for (const peer of this.peers.values()) peer.pc.restartIce();
    void this.beat();
  };

  private async post(body: Record<string, unknown>, keepalive = false) {
    const response = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, as: this.side, callId: this.callId }),
      keepalive,
    });
    const data = (await response.json().catch(() => ({}))) as { inCall?: boolean; error?: string };
    return { ok: response.ok, status: response.status, ...data };
  }

  /** Still here. If the server counted this device as gone, join again. */
  private async beat() {
    if (this.phase === "ended") return;
    try {
      const answer = await this.post({ action: "heartbeat" });
      if (answer.inCall !== false) return;

      this.phase = "reconnecting";
      this.emit();
      const joined = await this.post({ action: "join" });
      if (!joined.ok && joined.status < 500) this.end(joined.error ?? "The call has ended.");
    } catch {
      // No network: the next beat tries again. (Read afresh: the call may have ended while this waited.)
      if ((this.phase as SessionState["phase"]) !== "ended") {
        this.phase = "reconnecting";
        this.emit();
      }
    }
  }

  // --- the people in the call -------------------------------------------------

  /**
   * The call as the server last described it. Undefined once it has been seen
   * means it has ended; before that, the list simply has not caught up with a
   * call this device only just started.
   */
  sync(call: CallView | undefined) {
    if (this.phase === "ended") return;
    if (!call) {
      if (this.seen) this.end(null);
      return;
    }
    this.seen = true;

    const mine = call.participants.find((part) => part.memberKey === this.me);
    if (mine?.state === "JOINED" && mine.joinedAt) this.mySession = new Date(mine.joinedAt).getTime();

    for (const part of call.participants) {
      if (part.memberKey === this.me) continue;
      const before = this.people.get(part.memberKey);
      const joined = part.state === "JOINED";
      this.people.set(part.memberKey, { name: part.name, color: part.color, joined });

      const peer = this.peers.get(part.memberKey);
      if (!joined) {
        if (peer) this.closePeer(part.memberKey, false);
        if (before?.joined && this.phase !== "joining") playCallSound("left");
        continue;
      }

      const session = part.joinedAt ? new Date(part.joinedAt).getTime() : 0;
      if (peer && session && peer.session && peer.session !== session) this.closePeer(part.memberKey, false);

      if (!this.peers.has(part.memberKey) && this.mySession && part.joinedAt) {
        const iStart = initiates({ key: this.me, joinedAt: new Date(this.mySession) }, { key: part.memberKey, joinedAt: part.joinedAt });
        if (iStart) this.createPeer(part.memberKey, session, true);
      }
      if (before && !before.joined && this.mySession) playCallSound("joined");
    }

    // Anybody the server no longer lists has gone.
    const listed = new Set(call.participants.map((part) => part.memberKey));
    for (const key of [...this.people.keys()]) {
      if (!listed.has(key)) {
        this.people.delete(key);
        this.closePeer(key, false);
      }
    }

    if (mine?.state === "JOINED" && this.phase === "reconnecting" && [...this.peers.values()].every((peer) => peer.connection !== "reconnecting")) {
      this.phase = this.peers.size > 0 ? "live" : "joining";
    }
    this.emit();
  }

  /** Messages from the other devices, as the calls stream delivers them. */
  receive(signals: Signal[]) {
    for (const signal of signals) {
      if (signal.callId !== this.callId || this.phase === "ended") continue;
      const payload = (signal.payload ?? {}) as Payload;

      let peer = this.peers.get(signal.fromKey);
      if (peer && payload.session && peer.session && payload.session !== peer.session) {
        this.closePeer(signal.fromKey, false);
        peer = undefined;
      }
      if (!peer) {
        // Only an offer opens a connection from the other side; anything else is for one that no longer exists.
        if (signal.type !== "description" || payload.description?.type !== "offer") continue;
        peer = this.createPeer(signal.fromKey, payload.session ?? 0, false);
      }

      const target = peer;
      target.queue = target.queue.then(() => this.handle(target, signal.type, payload)).catch(() => undefined);
    }
  }

  private async handle(peer: Peer, type: string, payload: Payload) {
    const { pc } = peer;
    if (pc.signalingState === "closed") return;

    if (type === "description" && payload.description) {
      const description = payload.description;
      const collision = description.type === "offer" && (peer.makingOffer || pc.signalingState !== "stable");
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;

      await pc.setRemoteDescription(description);
      if (description.type === "offer") {
        await this.adopt(peer);
        await pc.setLocalDescription();
        if (pc.localDescription) this.send(peer.key, "description", { description: pc.localDescription.toJSON() });
      }
      for (const candidate of peer.pending.splice(0)) await pc.addIceCandidate(candidate).catch(() => undefined);
      return;
    }

    if (type === "candidates" && payload.candidates) {
      for (const candidate of payload.candidates) {
        if (!pc.remoteDescription) peer.pending.push(candidate);
        else await pc.addIceCandidate(candidate).catch(() => undefined);
      }
    }
  }

  private createPeer(key: string, session: number, initiator: boolean) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const channel = pc.createDataChannel("state", { negotiated: true, id: 0, ordered: true });
    const peer: Peer = {
      key,
      session,
      pc,
      polite: isPolite(this.me, key),
      makingOffer: false,
      ignoreOffer: false,
      channel,
      pending: [],
      roles: new Map(),
      remote: { ...QUIET, mids: { ...QUIET.mids } },
      quality: "unknown",
      lastPackets: null,
      connection: "connecting",
      restart: undefined,
      queue: Promise.resolve(),
    };
    this.peers.set(key, peer);

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) this.send(key, "description", { description: pc.localDescription.toJSON() });
      } catch {
        // Closed while offering.
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      const list = this.candidates.get(key) ?? [];
      list.push(candidate.toJSON());
      this.candidates.set(key, list);
      this.flushSoon(150);
    };
    pc.onconnectionstatechange = () => this.connectionChanged(peer);
    pc.onsignalingstatechange = () => {
      if (pc.signalingState === "stable") this.sendState(peer);
    };
    pc.ontrack = ({ track }) => {
      if (track.kind === "audio") this.meter(key, track);
      this.emit();
    };
    channel.onopen = () => this.sendState(peer);
    channel.onmessage = (event) => {
      const state = parseRemoteState(event.data);
      if (!state) return;
      peer.remote = state;
      this.emit();
    };

    if (initiator) {
      // Whoever offers lays out the transceivers: one for the microphone, one
      // for the camera, and one for a screen if it is being shared.
      peer.roles.set(pc.addTransceiver(this.mic ?? "audio", { direction: "sendrecv" }), "audio");
      peer.roles.set(pc.addTransceiver(this.camera ?? "video", { direction: "sendrecv" }), "camera");
      if (this.screen) peer.roles.set(pc.addTransceiver(this.screen, { direction: "sendrecv" }), "screen");
    }

    this.emit();
    return peer;
  }

  /** On receiving an offer: take on the other side's transceivers, sending this device's tracks on them. */
  private async adopt(peer: Peer) {
    const has = (role: Role) => [...peer.roles.values()].includes(role);
    for (const transceiver of peer.pc.getTransceivers()) {
      if (peer.roles.has(transceiver) || transceiver.currentDirection === "stopped") continue;
      const kind = transceiver.receiver.track.kind;

      let role: Role = "receive";
      if (kind === "audio" && !has("audio")) role = "audio";
      else if (kind === "video" && !has("camera")) role = "camera";
      else if (kind === "video" && this.screen && !has("screen")) role = "screen";
      peer.roles.set(transceiver, role);

      const track = role === "audio" ? this.mic : role === "camera" ? this.camera : role === "screen" ? this.screen : null;
      transceiver.direction = role === "receive" ? "recvonly" : "sendrecv";
      await transceiver.sender.replaceTrack(track).catch(() => undefined);
    }
  }

  private connectionChanged(peer: Peer) {
    const state = peer.pc.connectionState;
    clearTimeout(peer.restart);

    if (state === "connected") {
      peer.connection = "connected";
      if (this.phase !== "ended") this.phase = "live";
    } else if (state === "disconnected") {
      peer.connection = "reconnecting";
      // Often a moment's gap that heals itself; if not, find a new route.
      peer.restart = setTimeout(() => {
        if (peer.pc.connectionState !== "connected" && peer.pc.signalingState !== "closed") peer.pc.restartIce();
      }, 3000);
    } else if (state === "failed") {
      peer.connection = "reconnecting";
      peer.pc.restartIce();
    }

    if (this.phase === "live" && [...this.peers.values()].some((each) => each.connection === "reconnecting")) {
      this.phase = "reconnecting";
    }
    this.emit();
  }

  private closePeer(key: string, emit = true) {
    const peer = this.peers.get(key);
    if (!peer) return;
    clearTimeout(peer.restart);
    peer.pc.onnegotiationneeded = null;
    peer.pc.onicecandidate = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.ontrack = null;
    peer.channel.onmessage = null;
    peer.pc.close();
    this.peers.delete(key);
    this.candidates.delete(key);
    const meter = this.meters.get(key);
    if (meter) {
      meter.source.disconnect();
      this.meters.delete(key);
    }
    if (emit) this.emit();
  }

  private sendState(peer: Peer) {
    if (peer.channel.readyState !== "open") return;
    const midOf = (role: Role) => [...peer.roles].find(([, each]) => each === role)?.[0].mid ?? null;
    peer.channel.send(
      JSON.stringify({
        audioMuted: this.audioMuted || !this.mic,
        videoOff: !this.camera,
        sharing: Boolean(this.screen),
        mids: { camera: midOf("camera"), screen: this.screen ? midOf("screen") : null },
      })
    );
  }

  private broadcastState() {
    for (const peer of this.peers.values()) this.sendState(peer);
  }

  // --- the messages between devices ------------------------------------------

  private send(to: string, type: "description", payload: Payload) {
    this.outbox.push({ to, type, payload: { ...payload, session: this.mySession } });
    this.flushSoon(0);
  }

  private flushSoon(delay: number) {
    if (this.flushTimer) {
      if (delay > 0) return;
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => void this.flush(), delay);
  }

  private async flush() {
    this.flushTimer = undefined;
    if (this.flushing) {
      this.flushSoon(100);
      return;
    }

    // Candidates go after the description that came before them.
    for (const [to, list] of this.candidates) {
      this.outbox.push({ to, type: "candidates", payload: { candidates: list, session: this.mySession } });
    }
    this.candidates.clear();
    if (this.outbox.length === 0 || this.phase === "ended") return;

    const batch = this.outbox.splice(0, 40);
    this.flushing = true;
    try {
      const response = await fetch("/api/calls/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ as: this.side, callId: this.callId, signals: batch }),
      });
      if (response.status >= 500) throw new Error("retry");
    } catch {
      this.outbox.unshift(...batch);
      this.flushing = false;
      this.flushSoon(1000);
      return;
    }
    this.flushing = false;
    if (this.outbox.length > 0 || this.candidates.size > 0) this.flushSoon(0);
  }

  // --- what this device sends -----------------------------------------------

  setMuted(muted: boolean) {
    this.audioMuted = muted;
    if (this.mic) this.mic.enabled = !muted;
    this.broadcastState();
    this.emit();
  }

  /** Swaps the track on every connection's transceiver for one role, adding the transceiver where there is none. */
  private async swap(role: "audio" | "camera" | "screen", track: MediaStreamTrack | null) {
    for (const peer of this.peers.values()) {
      let transceiver = [...peer.roles].find(([, each]) => each === role)?.[0];
      if (!transceiver && role === "screen" && track) {
        // A video transceiver the other side opened for its own screen can carry this one back.
        transceiver = [...peer.roles].find(([t, each]) => each === "receive" && t.receiver.track.kind === "video")?.[0];
        if (transceiver) peer.roles.set(transceiver, "screen");
      }
      if (transceiver) {
        if (track && transceiver.direction !== "sendrecv") transceiver.direction = "sendrecv";
        await transceiver.sender.replaceTrack(track).catch(() => undefined);
      } else if (track) {
        peer.roles.set(peer.pc.addTransceiver(track, { direction: "sendrecv" }), role);
      }
    }
  }

  async setCamera(on: boolean, deviceId?: string | null) {
    if (!on) {
      this.camera?.stop();
      this.camera = null;
      await this.swap("camera", null);
    } else {
      const stream = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(deviceId) });
      const track = stream.getVideoTracks()[0];
      this.camera?.stop();
      this.camera = track;
      await this.swap("camera", track);
    }
    this.broadcastState();
    this.emit();
  }

  async setMicrophone(deviceId: string | null) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(deviceId) });
    const track = stream.getAudioTracks()[0];
    track.enabled = !this.audioMuted;
    this.mic?.stop();
    this.mic = track;
    this.meter(this.me, track);
    await this.swap("audio", track);
    this.broadcastState();
    this.emit();
  }

  async startSharing() {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
    const track = stream.getVideoTracks()[0];
    // Text on a screen should stay sharp rather than smooth.
    track.contentHint = "detail";
    // Sharing stopped from the browser's own bar.
    track.addEventListener("ended", () => void this.stopSharing());
    this.screen?.stop();
    this.screen = track;
    await this.swap("screen", track);
    this.broadcastState();
    this.emit();
  }

  async stopSharing() {
    if (!this.screen) return;
    this.screen.stop();
    this.screen = null;
    await this.swap("screen", null);
    this.broadcastState();
    this.emit();
  }

  // --- who is speaking, and how the connections are --------------------------

  private meter(key: string, track: MediaStreamTrack | null) {
    const existing = this.meters.get(key);
    if (existing?.track === track) return;
    if (existing) {
      existing.source.disconnect();
      this.meters.delete(key);
    }
    if (!track) return;

    try {
      const Context =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      this.audioContext ??= new Context();
      void this.audioContext.resume().catch(() => undefined);

      const source = this.audioContext.createMediaStreamSource(new MediaStream([track]));
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this.meters.set(key, { track, source, analyser, data: new Float32Array(analyser.fftSize), level: 0, speaking: false });
    } catch {
      // No speaking ring on a device that cannot measure sound; the call is unaffected.
    }
  }

  private sampleLevels() {
    let changed = false;
    const levels: Record<string, number> = {};

    for (const [key, meter] of this.meters) {
      meter.analyser.getFloatTimeDomainData(meter.data);
      let sum = 0;
      for (const value of meter.data) sum += value * value;
      const rms = Math.sqrt(sum / meter.data.length);
      // Quick to rise, slower to fall, like a level meter.
      meter.level = rms > meter.level ? rms : meter.level * 0.8 + rms * 0.2;

      const muted = key === this.me ? this.audioMuted : (this.peers.get(key)?.remote.audioMuted ?? false);
      const speaking = !muted && isSpeaking(meter.level, meter.speaking);
      if (speaking !== meter.speaking) {
        meter.speaking = speaking;
        changed = true;
      }
      if (key !== this.me && !muted) levels[key] = meter.level;
    }

    const next = nextSpeaker(this.speaker, levels, Date.now());
    if (next.key !== this.speaker.key) changed = true;
    this.speaker = next;

    if (changed) this.emit();
  }

  private async sampleStats() {
    let changed = false;
    for (const peer of this.peers.values()) {
      try {
        const report = await peer.pc.getStats();
        let rttMs: number | null = null;
        let jitterMs: number | null = null;
        let lost = 0;
        let received = 0;

        report.forEach((entry) => {
          const stat = entry as Record<string, unknown>;
          if (
            stat.type === "candidate-pair" &&
            stat.state === "succeeded" &&
            (stat.nominated || stat.selected) &&
            typeof stat.currentRoundTripTime === "number"
          ) {
            rttMs = stat.currentRoundTripTime * 1000;
          }
          if (stat.type === "inbound-rtp") {
            lost += typeof stat.packetsLost === "number" ? stat.packetsLost : 0;
            received += typeof stat.packetsReceived === "number" ? stat.packetsReceived : 0;
            if (typeof stat.jitter === "number") jitterMs = Math.max(jitterMs ?? 0, stat.jitter * 1000);
          }
        });

        const before = peer.lastPackets;
        peer.lastPackets = { lost, received };
        const newLost = before ? lost - before.lost : 0;
        const newReceived = before ? received - before.received : 0;
        const lossRatio = before && newLost + newReceived > 0 ? Math.max(0, newLost) / (newLost + newReceived) : null;

        const quality = qualityOf({ rttMs, lossRatio, jitterMs });
        if (quality !== peer.quality) {
          peer.quality = quality;
          changed = true;
        }
      } catch {
        // A closed connection has no statistics.
      }
    }
    if (changed) this.emit();
  }
}

function parseRemoteState(data: unknown): RemoteState | null {
  try {
    const value = JSON.parse(String(data)) as Partial<RemoteState> & { mids?: Partial<RemoteState["mids"]> };
    return {
      audioMuted: value.audioMuted === true,
      videoOff: value.videoOff !== false,
      sharing: value.sharing === true,
      mids: {
        camera: typeof value.mids?.camera === "string" ? value.mids.camera : null,
        screen: typeof value.mids?.screen === "string" ? value.mids.screen : null,
      },
    };
  } catch {
    return null;
  }
}

export type MediaProblem = "denied" | "no-microphone" | "no-camera" | "unavailable";

/**
 * The microphone, and the camera if asked for, as far as this device allows.
 * A camera that is missing or refused still gives a call with sound; a
 * microphone that is missing or refused still lets somebody join to listen.
 */
export async function openMedia(options: {
  video: boolean;
  micId?: string | null;
  cameraId?: string | null;
}): Promise<{ mic: MediaStreamTrack | null; camera: MediaStreamTrack | null; problem: MediaProblem | null }> {
  if (!navigator.mediaDevices?.getUserMedia) return { mic: null, camera: null, problem: "unavailable" };

  const attempt = async (audio: boolean, video: boolean) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: audio ? microphoneConstraints(options.micId) : false,
      video: video ? cameraConstraints(options.cameraId) : false,
    });
    return { mic: stream.getAudioTracks()[0] ?? null, camera: stream.getVideoTracks()[0] ?? null };
  };
  const nameOf = (error: unknown) => (error instanceof DOMException ? error.name : "");

  try {
    return { ...(await attempt(true, options.video)), problem: null };
  } catch (error) {
    const name = nameOf(error);
    if (name === "NotAllowedError" || name === "SecurityError") {
      // Refused together; the microphone alone may still be allowed.
      if (options.video) {
        try {
          return { ...(await attempt(true, false)), problem: "no-camera" };
        } catch {
          return { mic: null, camera: null, problem: "denied" };
        }
      }
      return { mic: null, camera: null, problem: "denied" };
    }
  }

  // Something missing or busy: try each on its own.
  let mic: MediaStreamTrack | null = null;
  let camera: MediaStreamTrack | null = null;
  try {
    mic = (await attempt(true, false)).mic;
  } catch {
    mic = null;
  }
  if (options.video) {
    try {
      camera = (await attempt(false, true)).camera;
    } catch {
      camera = null;
    }
  }
  return { mic, camera, problem: !mic ? "no-microphone" : options.video && !camera ? "no-camera" : null };
}
