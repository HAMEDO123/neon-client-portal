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

## Ringing with the app closed or the phone locked (PushKit + CallKit)
- The web can't: a closed tab gets the ordinary "Incoming call" push only.
- **Built** (`CallKitCenter.swift`, `App/VoipPush.swift`): the iPhone's own
  full-screen incoming call with the phone's ringtone, like WhatsApp. A VoIP
  push (`{"type":"incoming-call","callId","callerName","title","kind",
  "isGroup"}` on topic `<bundle id>.voip`) wakes the app; every push is
  reported to CallKit before PushKit's completion, even a malformed one or a
  call already over (reported, then ended at once), as iOS demands.
- The token is registered at `POST /api/mobile/devices` with `kind: "voip"`
  on every launch and after sign-in, and released with the alert token on
  sign-out. The server then stops sending that phone the "Incoming call"
  banner.
- **How the ring ends** — the server sends no "ended" push, so the calls
  stream does it (`CallKitCenter.reconcile`, after every `calls` list): the
  call gone from the list or ENDED → remote ended; this person JOINED on
  another device → answered elsewhere; DECLINED → declined elsewhere; taken off
  the call → remote ended. A push opens a fresh stream connection (unless a
  call is live on it), and only a list from a connection opened after the ring
  began may call a never-listed call gone. A ring nothing resolves ends after
  60 s (unanswered), and is not rung again in the app.
- Answer on CallKit's screen → `CallCenter.answer(callId:kind:title:video:)`,
  the same path as the app's Answer button. Locked or in the background the
  call is answered with sound (the camera can't run there); the call screen's
  camera button turns video on once the phone is open. The call screen opens
  full size when the app comes forward. End → decline while ringing, leave
  once in. Mute on either screen shows on the other.
- **Every live call on a phone is a CallKit call**, outgoing too
  (`CXStartCallAction`, reported connecting and connected): one audio path,
  the green pill, the lock screen's controls, and "End & Accept" for a second
  call. Holding, grouping and DTMF are not offered. Kept out of the Phone
  app's Recents (the app handles no call intents to call back from there).
- The simulator keeps calls the app's own (it never hands CallKit calls their
  audio); PushKit never reaches it either.

## Ringing in the app
- Full screen over whatever is open, in the calls' own window (CallWindow.swift)
  so no sheet can cover it: caller's name/avatar with spreading rings, "video
  call"/"call" wording, Decline, Answer — and for a video call, "answer with
  sound only". The phone vibrates every two seconds while it rings (no
  ringtone: the app ships no sound for it — see the redesign notes).
- Now the fallback: it stays out of the way while CallKit rings the same call,
  and on a phone registered for VoIP pushes a newly listed ring waits 2.5 s
  for the push before ringing here — so it still rings when no push comes
  (the simulator, a phone not yet registered, a push that never arrived).
- A banner when answering would end a call already in progress.
- Escape/back dismissal — **not built** (no hardware back gesture equivalent
  worth adding; Decline is one tap away).
- **Built** (`IncomingCallView`).

## Before joining (pre-join)
- See yourself, choose to go in muted or camera-off; a refused microphone or
  camera says so and offers Settings.
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
- **Built** (`CallScreenView` / `CallStage`): one other person fills the
  screen with this phone's own picture in a corner that drags to any other;
  three or more share a grid, or the web's **speaker view** (one large, the
  rest in a strip; tap one to show it large). A shared screen is fitted rather
  than cropped.
- Duration, connection state ("Connecting…"/"Reconnecting…"), a People sheet
  listing everyone asked and their state.
- **Built.**
- Mute, camera on/off (in a voice call too, as on the web), flip camera,
  speaker toggle, leave, minimise to a floating window that drags to any
  corner and floats above the app's sheets.
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
- **Built** (`CallAudioSession`). WebRTC runs in manual audio from launch
  (`useManualAudio`): CallKit activates the session and `provider(_:didActivate:)`
  hands it to WebRTC (`audioSessionDidActivate`, `isAudioEnabled`); a call
  CallKit does not carry (the simulator, or CallKit refusing it) is switched
  on directly. The speaker button follows the route when it moves without a
  tap (the lock screen's audio button, a headset).

## The simulator has no camera
- `LocalMedia.hasCamera` is false there; `openCallMedia` degrades to
  audio-only with `.noCamera` reported the same way a real refused camera
  is, so the pre-join and in-call screens show "camera not available" rather
  than crashing or hanging. Video calls therefore cannot be visually
  verified on the simulator — only compiled and read against the protocol;
  a device is needed to see a picture.
