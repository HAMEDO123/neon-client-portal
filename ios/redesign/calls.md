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
| `call-prejoin-voice` | Pre-join, voice call: a compact card with who you are calling, the microphone's level meter and chip, Mute, Start call |
| `call-prejoin-video` | Pre-join, video call with no camera found (the simulator's own state): "Start with sound only", no Flip |
| `call-prejoin-blocked` | Pre-join with microphone and camera refused: Open Settings is the main button, "Start anyway" the quiet one |
| `call-incoming-voice` | Ringing, private voice call |
| `call-incoming-video` | Ringing, private video call: Decline / Voice only / Answer |
| `call-incoming-group` | Ringing, group call: the studio's mark, "Sally started a video call", who is already in (in their colours) |
| `call-incoming-busy` | Ringing while already in a call: "End & answer", "You are in another call" |
| `call-ringing` | This phone calling, nobody answered yet |
| `call-connecting` | Answered, connection still not made after a while ("Still connecting…") |
| `call-voice` | One-to-one voice call, the other person speaking |
| `call-video-1to1` | One-to-one video call, the other side muted, own picture in the corner |
| `call-group-grid` | Four in a group call, grid |
| `call-group-speaker` | The same, speaker view |
| `call-reconnecting` | One-to-one, reconnecting, poor connection |
| `call-notice` | In a call with a notice (microphone refused), Open Settings, and the "No mic" button |
| `call-people` | People sheet: who is in / declined, Amro to ring (opens tall) |
| `call-people-empty` | People sheet of a group call everybody has been asked into |
| `call-mini-voice` | The minimised private voice call floating over the app |
| `call-mini-video` | The minimised group call: "NEON Team", "12:07 · Salem speaking" |
| `call-mini-pip` | The minimised call's video window (a track with no frames: the simulator has no camera) |
| `call-buttons` | The conversation header's call buttons and the Join / Back to call pills |
| `callkit-incoming` | Rings CallKit's own incoming screen for a made-up voice call from Sally (no stream, no server), and says on the page what became of it |
| `callkit-incoming-video` | The same for a video call |

No screen is long enough to need a `-neonScroll` anchor. The fixtures give
people the colours the live server gives them (Sally purple, Salem pink,
Amro and Wael cyan, the manager ink), as the chat list shows them.

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

## Round two (the critic's review of the live screenshots)

- **Faces are the chat's faces** (`CallFaces.swift`). Every face on a call —
  the big halo, grid and strip tiles, the minimised window, the people
  sheet, the incoming screen's "in the call" stack — is drawn with the
  chat's `ChatAvatar` / `ChatStudioMark` in the colour the server gives each
  person (`CallParticipant.color`, `CallMember.color`), instead of a hash of
  the name. The team is the studio's mark; a group without a photo is the
  chat's group face. The stage's glow comes from the same colour
  (`ChatTint`). For what a call does not carry — the colour of the person
  about to be rung on the pre-join, a group's photo — `CallFaceDirectory`
  reads the chat's own `chat/conversations` list (read-only, at most every
  two minutes, on sign-in, on a pre-join and when a new group call appears).
  People have no photos on the platform (`Employee` has no photo field), so
  only groups can show one.
- **No muddy stages.** Orange, amber, green and red glow at 0.28 instead of
  0.55; tiles run from the person's colour into indigo, never grey.
- **Pre-join.** Header: the X sits beside the overline and name, the one-line
  subtitle has the full width, the overline uses `.neonOverline`. Voice: a
  ~250 pt card with the halo, a live level meter (`CallMicLevelMonitor`: an
  `AVAudioRecorder` writing to /dev/null, metering only, stopped before the
  microphone is handed to the call) and the microphone chip. Video with no
  camera: "Start with sound only" / "Join with sound only", no Flip.
  Microphone refused and no picture: Open Settings is the brand button,
  "Start anyway: you won't be heard or seen" the quiet one, and the notice
  loses its own Settings button. Chips say "Microphone blocked" / "Camera
  blocked" (lock, amber) read from the permission itself, so they stay true
  after the notice is closed.
- **One meaning for a white disc** on every call screen: "you are not sending
  this" (muted, no microphone, camera off). Toggle names match on both
  screens: Mute / Unmute, Camera / Camera off. The speaker keeps the glass
  and shows "on" with its glyph and an indigo dot. With no microphone the
  bar's button is "No mic" with a warning mark, and opens Settings.
- **Touch targets**: the header's call glyphs and the Join / Back to call
  pills keep their drawn size but are touched across 44 pt (without taking
  layout room in the chat header); the notice's action is a 44 pt
  `NeonButton` and its X a 44 pt frame; the minimised hang-up is 44 pt and
  refuses a tap that a drag of the window ends on.
- **Minimised window**: solid brand ink, 16 pt gutter; a group call names the
  group first with "12:07 · Salem speaking" under it. The video window's
  hang-up is no longer a button inside a button, and it names the person
  (it used to say "You" for anybody muted).
- **Incoming, busy**: the answer button says "End & answer"; the separate
  capsule became a quiet "You are in another call" line.
- **People sheet**: no second heading; one ~56 pt row each with the state as
  a trailing badge; "Ring someone in" as a list with 44 pt Ring buttons;
  opens tall when anybody can be rung; the empty case says why ("Everyone on
  the team has already been asked into this call.").
- **Speaker strip** tiles share the width (up to 118 pt, 3:4), centred.
- **Still connecting** adds "Some networks block calls. You can hang up and
  try again."
- One speaking cue per tile (border on grid/large, ring on strip/pip); no
  connection bars on a tile that is not connected.
- **Arabic**: whole-sentence keys for "%@ started a (video) call"
  ("مكالمة (فيديو) من %@", no gendered verb); the duration now uses the
  app's digits like the people count; "Left" and "Speaking" reworded
  without a gendered verb; signal bars stay left to right. Checked on "NEON
  QA 11" with `-uiTestMode -app_language ar`: pre-join (X on the left),
  controls mirrored, name tags at bottom-leading, notice, mini window.

Skipped, with reasons:

- **"Ring again" on DECLINED / LEFT rows**: the server cannot do it —
  `inviteToCall` (`src/lib/call-store.ts:108`) drops anybody already a
  participant in any state, so the button would report success and ring
  nobody. Needs a server change outside this area (see open issues).
- **Hiding the people pill in a private call**: it is how somebody else is
  rung into a one-to-one call (the server offers the whole team), so hiding
  it would remove a feature. The fixture's empty sheet was the fixture's
  mistake: a private call almost always has people to ring. The empty state
  now says why, and the fixture shows the real empty case.

## Round three: ringing like a phone (branch `ux-callkit`)

The owner wanted a closed or locked iPhone to *ring* for a call, as WhatsApp
does, not show a banner. That is PushKit + CallKit; the server side (VoIP
token storage, the push itself) was written alongside by the orchestrator.

- **`App/VoipPush.swift`** — a `PKPushRegistry` for `.voIP`, created in the
  app delegate's `didFinishLaunching` (it must exist before the push that
  launched the app is delivered). Its token is registered at
  `POST api/mobile/devices` with `{token, bundleId, sandbox (DEBUG builds
  true), deviceName, appVersion, kind: "voip"}` on every launch and after
  sign-in (only while signed in), and released by `PushCenter.unregister`
  together with the alert token, using the bearer captured before sign-out.
- **`CallKitCenter.swift`** — one `CXProvider` ("NEON" from the display name,
  video, one call at a time, generic handles, a monochrome "N" template icon,
  out of Recents) and one `CXCallController`; server call ids map to CallKit
  UUIDs per call. Every VoIP push is reported with `reportNewIncomingCall`
  before PushKit's completion — a malformed one, one for a call this phone is
  already in, answering, declined or no longer invited, or one that arrives
  signed out is reported and ended at once with the matching reason.
- **How the ring ends.** The server sends no "ended" push. CallKit keeps the
  app running while it rings, so the calls stream decides: `reconcile` runs
  after every `calls` list — ENDED or gone from the list → `.remoteEnded`;
  this person JOINED → `.answeredElsewhere`; DECLINED → `.declinedElsewhere`;
  no longer a participant → `.remoteEnded`. The push reopens the stream (a
  connection the phone was suspended on may be dead without knowing it), and
  a call never yet listed is called gone only by a list from a connection
  opened after the ring began. Otherwise a 60 s timeout ends it
  (`.unanswered`) and the app does not ring it again.
- **Answer / End / Mute.** Answer joins through `CallCenter.answer`, which the
  app's own Answer button now shares (`accept` calls it). Not active (locked,
  background) → sound only; the call screen's camera button adds video after
  unlocking. The action is fulfilled at once and the call screen is full size
  when the app comes forward. End declines a ringing call and leaves a live
  one (with background time, so the server hears it before iOS suspends the
  app); a hang-up before the join has finished leaves the call the moment it
  opens. Mute is synced both ways.
- **Outgoing calls go through CallKit too** (chosen): every live call on a
  device — started, joined from a pill, or answered on the app's ringing
  screen — is a CallKit call (`CXStartCallAction`, `reportOutgoingCall`
  connecting/connected). One audio path, the green pill, the lock screen's
  controls, and CallKit's own "End & Accept" when a second call rings. If
  CallKit refuses a call it carries on as the app's own.
- **Audio.** `RTCAudioSession.useManualAudio = true` from launch.
  `provider(_:didActivate:)` → `audioSessionDidActivate` + `isAudioEnabled =
  true`; `didDeactivate` the reverse. `CallAudioSession.configure` now only
  sets the category and route; a call CallKit does not carry (the simulator)
  is activated directly. The session is CallKit's to switch off, which keeps
  the sound on when one call is ended to answer another. The pre-join's level
  meter switches its session off before handing over (`handOver`), leaving
  activation to CallKit. The speaker button follows route changes.
- **No double ringing.** While CallKit rings a call, `ringingCall` leaves it
  out (no in-app screen, no buzz). On a phone registered for VoIP pushes a
  newly listed ring waits 2.5 s for the push before the app rings it itself —
  it still rings in the app when no push comes.
- `UIBackgroundModes: [audio, voip]` in `project.yml`; PushKit and CallKit are
  linked by their imports.

**The simulator cannot show CallKit's incoming screen.** `callkit-incoming`
reports its call and CallKit accepts it (no error), then ends it about 25 ms
later: callservicesd shows an incoming call by opening
`facetime://?launchForIncomingCall=1`, and the simulator has no app for it
(LaunchServices -10814). Seen on the iOS 26.5 and 17.2 runtimes, and with a
bare provider configuration too. The fixture's page says so ("Ended at once
by the phone…"), which proves the report path runs; on an iPhone running a
Debug build from Xcode the same id shows CallKit's real screen, with no
server involved. Checked on "NEON QA 10" (UDID 631CFE4C…) with
`-uiTestMode`, English and Arabic.

**Only a real iPhone can confirm** (with the server's VoIP push live):
the ring on a locked phone and with the app force-quit; the ringtone;
answering from the lock screen and hearing both ways (CallKit's audio
activation handed to WebRTC); the ring stopping when the caller hangs up,
when it is answered on the web, and after 60 s; decline reaching the server
from a locked phone; "End & Accept" between two NEON calls, and a cellular
call arriving during one; mute and the speaker/AirPods route on the lock
screen matching the app; an outgoing call's green pill and lock-screen
controls; the call screen appearing when the app is opened after answering;
a first call answered on the lock screen before the microphone was ever
allowed (the permission prompt can only appear once the app is open, so the
join waits for it); sandbox vs production VoIP tokens (a Debug build from
Xcode registers `sandbox: true`, TestFlight `false`).

## Open issues

- **Ringing with the app closed** — built in round three; waiting on a real
  iPhone and the live VoIP push to confirm.
- **No ringtone in the app's own ringing**, only vibration (no sound asset
  ships). CallKit's ring uses the phone's own ringtone.
- **A phone signed out by a refused token** (401, not the Sign Out button)
  cannot release its VoIP token — its bearer no longer works — so it may keep
  receiving pushes (each reported and ended at once) until somebody signs in
  on it or the server retires the token.
- **Chat voice notes change the shared audio session**
  (`Features/Chat/ChatVoiceRecorder.swift:44` sets `.playAndRecord`/`.default`
  with speaker, `:127` sets `.playback`). Played or recorded while a call is
  minimised, that silenced the call's microphone. Calls now put their
  configuration back on any category change; the chat area should leave the
  session alone while `CallCenter.shared.session != nil`.
- **Server**: `src/app/api/mobile/calls/stream/route.ts:31` starts a stream
  with no Last-Event-ID at the newest signal. Sending the starting cursor as
  the `ready` event's `id:` would close the gap for the web too.
- **Server**: `addableToCall` (`src/lib/call-store.ts:78`) and
  `inviteToCall` (`:108`) leave out anybody already a participant in any
  state, so somebody who declined or left cannot be rung again — which is
  why the people sheet has no "Ring again".
- The pre-join level meter and its hand-over of the audio session to the call
  are untested on a device (the simulator fixture shows it idle).
- Unverified on a device: the calls window's status bar style, audio routing
  with AirPods, camera hand-over and flip, implicit rollback against Safari.
- Still not built (unchanged): sending a screen share, the in-call chat
  panel, remembered devices, this phone's own speaking ring.
