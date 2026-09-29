# Calls — redesign notes

Branch `ux-calls`. All changes are in `ios/Sources/Features/Calls/` and
`ios/Resources/ar.lproj/Calls.strings`. No server code touched.

## Screens and sheets (debug router ids)

A call cannot be opened without ringing real people, so every screen has a
Debug-only fixture in `CallsScreens.swift`: the real view, drawn from fixed
values, with no network, microphone or camera. There is no picture in any of
them (the simulator has no camera), so every tile shows its avatar.

| id | What it shows |
|---|---|
| `call-prejoin-voice` | Pre-join, voice call: who you are calling, mic toggle, Start call |
| `call-prejoin-video` | Pre-join, video call with the camera unavailable (the simulator's own state) |
| `call-prejoin-blocked` | Pre-join with microphone and camera refused: the notice with Open Settings |
| `call-incoming-voice` | Ringing, private voice call |
| `call-incoming-video` | Ringing, private video call: Decline / Voice only / Answer |
| `call-incoming-group` | Ringing, group call: "Sally started a video call", who is already in |
| `call-incoming-busy` | Ringing while already in a call: "Answering ends the call you are in." |
| `call-ringing` | This phone calling, nobody answered yet |
| `call-connecting` | Answered, connection still not made after a while ("Still connecting…") |
| `call-voice` | One-to-one voice call, the other person speaking |
| `call-video-1to1` | One-to-one video call, the other side muted, own picture in the corner |
| `call-group-grid` | Four in a group call, grid |
| `call-group-speaker` | The same, speaker view |
| `call-reconnecting` | One-to-one, reconnecting, poor connection |
| `call-notice` | In a call with a notice (microphone refused) and Open Settings |
| `call-people` | People sheet: who is in / ringing / declined, Ring someone in |
| `call-people-empty` | People sheet when nobody else can be rung |
| `call-mini-voice` | The minimised voice call floating over the app |
| `call-mini-video` | The minimised call (video) floating over the app, Arabic corner |
| `call-buttons` | The conversation header's call buttons and the Join / Back to call pills |

No screen is long enough to need a `-neonScroll` anchor.

For my own checks I ran these on "NEON QA 11" with `-uiTestMode` (the offline
test mode: every APIClient call fails as offline, and the calls stream now
stays shut in that mode too), so nothing reached the live server.

## What changed

- **The look.** Calls are the one place the app goes dark, the way a phone
  call does: the ink hero gradient with the brand's sky, indigo and violet
  glowing through, warmed towards the person on the call. Round frosted
  controls with their names under them (white when switched on, red to hang
  up, green to answer), the kit's avatars large with spreading rings while
  ringing and the brand's story ring while somebody speaks, connection bars
  in green / amber / red, frosted name tags on tiles. The people sheet stays
  light and uses the kit's sheet header, section cards, state badges and
  buttons.
- **Own window** (`CallWindow.swift`). Everything calls draw lives in a
  window above the app's (below the kit's toasts). A ringing call used to be
  drawn under any open sheet; the pre-join was a sheet that could not open
  from a screen already in a sheet. The window takes every touch while
  something full screen is up, and only the floating window's (or notice's)
  touches otherwise.
- **Pre-join** is full screen: preview card, mic / camera / flip toggles,
  status chips, the device problem with a way to Settings, one brand button.
- **Incoming** is full screen with Decline / (Voice only) / Answer; the answer
  button breathes; a spinner stays until the call has actually opened.
- **In the call**: one other person fills the screen (picture, or the avatar
  large with name, time and quality); own picture in a corner, draggable to
  any corner; three or more in a grid or the web's speaker view (new — was
  "not built"). Tap a full-screen picture to hide the controls.
- **Minimised**: a floating window (picture for video, a compact card for
  voice) that drags to any corner and floats above sheets.
- **Camera button in voice calls**, as the web has.
- `CallButtons` keeps its API; the Join / Back to call pills are now green
  capsules with a live dot.

Kept deliberately: every action (mute, camera, flip, speaker, hang up,
minimise, people, ring someone in, decline, answer, answer with sound only,
join, back to call), the calls protocol and its wording, Arabic for every
string.

## Why calls failed on a real iPhone — findings and fixes

Line numbers are in the base (`ux-base2`) unless marked *now*.

1. **The answering phone often never offered.** `CallCenter.begin` created
   the session and waited for the *next* calls event to learn it had joined
   (`CallCenter.swift:253-262`). The stream polls every 700 ms and often
   delivers "you joined" before the join's own POST answers, so that event
   went to no session; nothing else changed afterwards, so the answerer —
   who is the one who offers — never did. Both phones sat on "Connecting…".
   The web re-syncs whenever the session changes. Fixed: sync at once with
   the list already held (*now* `CallCenter.swift:298`).
2. **Glare deadlocked.** Native WebRTC refuses an offer that arrives while it
   holds its own unless `enableImplicitRollback` is set (browsers do this by
   themselves), so the polite side's `setRemoteDescription` failed silently
   and both sides waited for an answer (`CallSession.swift:350-353`). And
   native "negotiation needed" fires even while a remote offer is being
   applied (the answerer's first data channel does it every time), so an
   offer could be made mid-answer (`CallSession.swift:428-449`). Fixed:
   implicit rollback on, and offers go through the connection's queue and are
   only made from a stable state (*now* `CallSession.swift:387`, `:468`).
3. **Session ids did not match the web's.** Milliseconds were truncated from a
   parsed date (a ".123" can land a hair under 123), and a `session` of 0
   (the web's "not known yet") was read as a different session — either way
   the connection was closed and the answer it carried dropped
   (`CallSession.swift:241`, `:253-255`, `:289-290`). Fixed: rounded, and 0
   ignored as the web does (*now* `CallSession.swift:312`, `:796`).
4. **Video calls sent a frozen picture.** The pre-join stopped its camera when
   the sheet closed — after handing that camera's track to the call
   (`PreJoinView.swift:76`); answering dropped its `LocalMedia` as soon as
   `accept` returned (`CallCenter.swift:275`); and the session had its own
   empty `LocalMedia` (`CallSession.swift:149`), so camera off and flip never
   reached the real capturer (flip started a second one; "on" always asked
   for the front, `:596`). Fixed: the media is handed to the session, which
   owns and stops it; flip switches device on the same capturer and track.
5. **Audio route undone by WebRTC.** `CallAudioSession.configure` set the
   category before audio began; WebRTC then applied its own default
   configuration when its audio unit started (no speaker option), undoing it
   — a video call played through the earpiece while the button said speaker
   (`CallAudioSession.swift:12-25`). Fixed: our configuration is handed to
   WebRTC (`RTCAudioSessionConfiguration.setWebRTC`) and the session is
   activated at call start, which also keeps a ringing caller's app alive with
   the screen locked. Mid-call speaker toggles change only the category. The
   session was also deactivated without a matching activation, unbalancing
   RTCAudioSession's count.
6. **A network blip ended the call.** When the heartbeat learned the server
   had dropped this phone, any failure of the rejoin — including no network,
   the very thing that caused the drop — ended the call
   (`CallSession.swift:684-688`). Fixed: only a refusal ends it, as on the web.
7. **Ringing hidden, call button dead** from a screen inside a sheet (the
   overlay lived in the app's own window, `CallStubs.swift:86-97`, `:120`).
   Fixed by the calls window.
8. **Decline looked unresponsive**: the dismissed-call set was not published,
   so the ringing overlay stayed until the server's next list
   (`CallCenter.swift:48`). Fixed.
9. **A refused microphone also cost the camera** (`CallMedia.swift:112-116`),
   and a refused camera read as "not available" with no way to Settings.
   Fixed: each is asked for on its own; refusals say so and offer Settings.
10. **Refused signal batches were retried every second for ever**
    (`CallSession.swift:565-570`); the web drops them. Fixed.
11. **An ended call could close the next one**: `endSession` cleared whatever
    session was on screen (`CallCenter.swift:265`). Fixed: only its own.
12. **Stream resume gap**: a stream reconnecting mid-call before any signal
    had arrived sent no Last-Event-ID, and the server starts such a stream at
    the newest signal, skipping an offer sent in the gap
    (`CallCenter.swift:138`). Mitigated in the app (*now*
    `CallCenter.swift:157`); see open issues for the server side.
13. `RTCInitializeSSL()` is now called before the factory is built.

None of this was verified by a real call (no sign-in, no device). It compiles
and reads right against `components/calls/call-session.ts`; the orchestrator's
live screenshots and a TestFlight call are the real test.

## Open issues

- **No ringing with the app closed or in the background.** Incoming calls
  arrive only through the open calls stream; there is no VoIP push
  (PushKit/CallKit) and no APNs on the server. A phone in a pocket with the
  app closed does not ring. Needs server APNs + PushKit + CallKit.
- **No ringtone**, only vibration: no sound asset ships with the app.
- **Chat voice notes change the shared audio session**
  (`Features/Chat/ChatVoiceRecorder.swift:44` sets `.playAndRecord`/`.default`
  with speaker, `:127` sets `.playback`). Played or recorded while a call is
  minimised, that silenced the call's microphone. Calls now put their
  configuration back on any category change; the chat area should leave the
  session alone while `CallCenter.shared.session != nil`.
- **Server**: `src/app/api/mobile/calls/stream/route.ts:31` starts a stream
  with no Last-Event-ID at the newest signal. Sending the starting cursor as
  the `ready` event's `id:` would close the gap for the web too.
- **Server**: `addableToCall` (`src/lib/call-store.ts:82`) leaves out anybody
  already a participant in any state, so somebody who declined or left cannot
  be rung again.
- Unverified on a device: the calls window's status bar style, audio routing
  with AirPods, camera hand-over and flip, implicit rollback against Safari.
- Still not built (unchanged): sending a screen share, the in-call chat
  panel, remembered devices, this phone's own speaking ring.
