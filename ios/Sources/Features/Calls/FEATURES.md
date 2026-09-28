# Calls — feature inventory

What the web's calls area does (`src/components/calls/*`, `src/lib/calls.ts`,
`src/lib/call-store.ts`), and what this native build does with it.

## Where a call can start
- A voice and a video button in a conversation's header, for every kind of
  conversation the chat area creates (team group, an admin↔employee direct
  chat, a peer chat between two employees) — `mayCallIn` covers all three, so
  nothing here refuses a conversation the chat area would open.
- **Built.** `CallButtons(slug:title:)`.

## Joining an existing call
- "Join call" pill when a call is already running (somebody has answered) in
  this conversation and this device isn't in it.
- "Back to call" pill when this device is in the call but it's minimised.
- **Built.**

## Ringing
- An overlay on top of whatever screen is open: caller's name/avatar, "video
  call"/"call" wording, Decline, Answer — and for a video call, "answer with
  sound only".
- A banner when answering would end a call already in progress.
- Escape/back dismissal — **not built** (no hardware back gesture equivalent
  worth adding; Decline is one tap away).
- **Built** (`IncomingCallView`).

## Before joining (pre-join)
- See yourself, hear the mic, choose to go in muted or camera-off.
- Web: pick which microphone/camera among several. iOS: one front and one
  back camera — **replaced with a flip-camera button**, which is the native
  equivalent.
- Devices remembered across calls (web: localStorage). **Not built** — every
  call opens with the mic on, camera matching the call kind; a small trim,
  noted rather than silently dropped.
- **Built** (`PreJoinView`).

## The call itself
- WebRTC: one RTCPeerConnection per other person, perfect negotiation (polite
  side yields on a collision), a transceiver per role (mic/camera/screen) so
  toggling the camera never renegotiates, a data channel carrying
  muted/camera/sharing state and each role's transceiver `mid`.
- **Built exactly to the protocol** in `CallSession.swift` — same signal
  shapes, same session-id rejoin detection, same role-adoption on an incoming
  offer, same data channel label/id (`state`, negotiated, id 0).
- ICE restart on a dropped connection, heartbeat every 5s with automatic
  rejoin if the server drops this device for going quiet.
- **Built.**
- Grid layout (1 up to many), a name/mute badge per tile, a speaking ring,
  per-connection quality glyph, a "reconnecting" spinner on a tile.
- **Built** (`CallScreenView`), grid layout only — the web's **speaker view**
  toggle (one big tile + a filmstrip) is **not built**; the grid alone covers
  every size a phone call realistically has today. Screen-share layout
  (fitting the shared screen instead of covering it) is likewise not built,
  though a shared screen *is* received and shown as an ordinary tile — see
  below.
- Duration, connection state ("Connecting…"/"Reconnecting…"), a People sheet
  listing everyone asked and their state.
- **Built.**
- Mute, camera on/off, flip camera, speaker toggle, leave, minimise to a
  floating pill.
- **Built.**
- **Screen sharing:** the web can start one (`startSharing`/`stopSharing`,
  `getDisplayMedia`). Native screen sharing needs a Broadcast Upload
  Extension (ReplayKit) with its own app-extension target and entitlement —
  a second Xcode target this area doesn't own the project settings to add
  cleanly within the "only touch `project.yml` for the WebRTC package" rule.
  **Not built as a sender.** As a **receiver** it is: `CallSession` still
  reads the data channel's `sharing`/`mids.screen` fields and renders the
  other side's shared screen like any other video tile, so a phone can watch
  a browser's screen share; it just can't start one itself.
- **In-call chat panel** (the web's `CallChat`, reusing the chat stream to
  send messages without leaving the call): needs a `chat/send` mobile
  registry entry, which the chat area's own registry file doesn't have yet
  (`src/lib/mobile/registry/chat.ts` — outside this area's files). **Not
  built**; report to the chat area if wanted.
- **Local speaking ring** (this device's own tile pulsing while it talks):
  the web meters the raw microphone track every 120ms with Web Audio.
  WebRTC's iOS SDK has no equivalent tap, so this device's own tile never
  shows a speaking ring — **trimmed**. Remote speaking (everyone else's
  tiles) *is* shown, read from `getStats()`'s `audioLevel` every 2s (the
  same interval the quality bars use, rather than the web's 120ms — a
  battery trade worth making on a phone).

## Interoperating with a browser
- Same server routes' behaviour (`/api/mobile/calls`, `.../signal`,
  `.../stream` — new files, reusing `lib/calls.ts`/`lib/call-store.ts`
  unchanged), same signal payload shapes, same roles, same data channel
  label/messages, same ICE-server source (Cloudflare STUN/TURN).
- **Verified by:** reading call-session.ts line by line against
  `CallSession.swift`; not by an actual phone↔browser call, which needs the
  live server (see notes in the run's final report).

## Audio routing
- Earpiece for a voice call, speaker by default once video is showing
  (`AVAudioSession`, category `.playAndRecord`, mode `.voiceChat`), with a
  manual speaker toggle. Bluetooth/AirPods are left to iOS's own routing UI.
- **Built** (`CallAudioSession`).

## The simulator has no camera
- `LocalMedia.hasCamera` is false there; `openCallMedia` degrades to
  audio-only with `.noCamera` reported the same way a real refused camera
  is, so the pre-join and in-call screens show "camera not available" rather
  than crashing or hanging. Video calls therefore cannot be visually
  verified on the simulator — only compiled and read against the protocol;
  a device is needed to see a picture.
