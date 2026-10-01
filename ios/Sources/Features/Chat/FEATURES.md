# Chat — feature inventory

What the chat area does on the phone, and where it lives. The room's redesign
notes are `ios/redesign/chatroom.md`; this file keeps the inventory of what a
conversation can show and do. Strings are in
`ios/Resources/ar.lproj/ChatRoom.strings` (the room) and `Chat.strings` /
`ChatList.strings` (the list).

## Media in a conversation

### Photos
- Frameless, rounded, the time and ticks over the bottom corner, a caption in a
  slim bubble underneath; four or more in a row from one person become a grid.
  A tap opens the full-screen viewer, which swipes through every photo in the
  conversation. **Built** (`ChatPhotos.swift`, `ChatMessageRow.swift`).

### Videos — drawn and played as videos, never as a file
- The server has no video kind: a video arrives as the form's `document` and is
  stored as a `FILE` whose `attachmentType` is its extension (`mp4`; a few rows
  say `video/mp4`). `ChatMessage.isVideo` decides from the type, then the
  name, then the address (`mp4`, `mov`, `m4v`, any `video/*`) — so a video sent
  from this phone, from the website, or shared in through the share extension
  (which sends `<name>.mp4`) is drawn the same way. A real file keeps the file
  bubble. **Built** (`ChatVideo.swift`).
- **The bubble** is frameless like a photo, at the video's own shape (clamped
  like photos, 3:4 to 16:10): a frame from the video, a soft shade, a round play
  button, its length with a camera glyph in the bottom leading corner, the time
  and ticks in the bottom trailing one, the project tag over the top, the
  caption underneath. Shimmers while the frame is read; a dark tile with a film
  glyph if it cannot be (still tappable — the player may manage). Mirrors in
  Arabic; the play glyph does not.
- **The frame** is read from the remote file with `AVAssetImageGenerator`
  (half a second in, past a fade from black) and the length from the asset —
  never on the main thread. The media route serves byte ranges, so only the
  start and the index of the file are fetched. Kept in memory and on disk
  (`Caches/NeonVideoPosters`, by a hash of the address; files untouched for a
  month are tidied). `ChatVideoPosters`.
- **Sending one**: while it uploads, the bubble shows the frame read from the
  bytes this phone holds, with a spinner in the play button; when the server
  answers, that frame is kept under the server's address, so the real message
  draws at once without fetching anything (`ChatConversationStore.pump`).
- **Full screen**: a tap opens AVKit's own player (`AVPlayerViewController`,
  system controls — play, scrubber, AirPlay, its own full-screen button; no
  picture in picture) on a black page, with Close, who sent it and when, and
  **Share or save**, which downloads the file and opens the share sheet (Save to
  Files, AirDrop, WhatsApp…). It streams, so it starts before the file is all
  here. A voice note playing stops; during a call the audio session is left to
  the call. `ChatVideoPlayerScreen`.
  - **Save Video (to Photos) is hidden** from that share sheet until the app's
    Info.plist carries `NSPhotoLibraryAddUsageDescription` (`project.yml`, which
    this area does not own): without the key iOS stops the app on the spot when
    Save Video is tapped. The sheet offers it by itself once the key is there.
- The list's last-message line, and the pinned strip, say "🎥 Video" for one.

### Voice notes
- Play/pause disc, the bars read from the recording itself, filling as it
  plays, the time counting while it plays. **Built.**
- **Speed: 1× → 1.5× → 2× → 1×**, WhatsApp's way — a small pill under the bars
  of every note. One setting for every note (`ChatVoicePlayer.rate`), kept until
  the app quits; a tap changes the note playing now and every one after it.
  `AVAudioPlayer` with `enableRate` set before `prepareToPlay`, so the pitch
  stays. The bars and the time follow the recording's own position
  (`currentTime`), so both stay right at 1.5× and 2×. **Built**
  (`ChatVoiceRecorder.swift`, `ChatVoiceSpeedPill` in `ChatMessageRow.swift`).
- There is no drag-to-seek on the bars (there was none before either).

### Files
- A tile per kind (PDF red, sheets green, drawings cyan…), name, type, size;
  a tap opens it. **Built.**

## Pictures full screen
- **The header**: tapping the conversation's picture or its name opens that
  picture full screen, WhatsApp's way — black page, the name and the header's
  own line (online now, last seen, how many in the group) on top; pinch or
  double-tap to zoom, drag to look around while zoomed, swipe up or down (or
  Close) to put it away, a tap hides the chrome. The photo shows at once from
  the copy the header already has and sharpens at 1600 px. **Built**
  (`ChatFaceViewer.swift`).
  - Somebody with no photo: their large initials on their own colour. A group
    without a photo: the group glyph on its colour. The team: the studio's mark.
- **A group the manager made keeps its info** (which the name used to open):
  a **Group info** button on the picture's page, **Group info** in the room's ⋯
  menu (beside Search), and on a long press of the header.
- **A sender's face** beside their message in a group (and beside a grid of
  their photos) opens the same viewer, with their photo or initials and colour
  from the room's palette. The assistant's sparkles do not.

## Debug router ids (`ChatRoomScreens.swift`)
The room's live screens (`chat-room-team`, `-direct`, `-group`, `-search`,
`-cards`, `chat-meetings`, the sheets) read the server. These read nothing: the
files are made on the phone at launch (two videos drawn frame by frame, a file
that is not a video, two synthesised voice notes, a portrait), so they open
with `-uiTestMode` and no sign-in.

| Id | What |
|---|---|
| `chat-media` | A group conversation of media: a landscape video with a caption, a portrait one of mine (read), one that cannot be read, two voice notes with the speed pill, a PDF, and a video still going up. `-neonScroll voice` for the lower half. |
| `chat-media-fast` | The same, voice notes at 1.5×. |
| `chat-video-player` | A video full screen in the player. |
| `chat-face-viewer` | A person's photo full screen. |
| `chat-face-viewer-initials` | A person with no photo: initials on their colour. |
| `chat-face-viewer-group` | A group the manager made, with its Group info button. |
| `chat-face-viewer-team` | The team: the studio's mark. |

## Only a real phone can confirm
- A real `.mp4` from R2 through `/api/media`: the frame and length read over
  byte ranges, and playback streaming (the simulator fixtures use local files).
- The speed's sound at 1.5× and 2× (pitch kept), and with the silent switch on.
- AVKit's controls, AirPlay and its own full-screen button inside the page.
- The share sheet's targets (WhatsApp, Files, AirDrop) with a downloaded video.
