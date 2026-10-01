# Chat camera — feature inventory

The chat's own camera and photo editor, laid out like WhatsApp's (the owner's
two screenshots), and the same camera for stories. Opened full screen from the
composer's camera button and from + → Camera (`ChatRoomView`'s
`fullScreenCover`), and for a story through `NeonCameraView`.

(There was no `Chat/FEATURES.md` on the branch this was built on, so the
camera's notes live here, beside its code. XcodeGen leaves `*.md` out of the
app.)

## Files
| File | What |
|---|---|
| `ChatCameraController.swift` | The engine: one `AVCaptureSession` (preset High) with a photo output and a movie output; lenses, zoom stops, focus, flash/torch, rotation, the preview-shaped crop. |
| `ChatCameraView.swift` | The camera screen and the live preview layer. |
| `ChatRecentPhotos.swift` | PhotoKit: the strip's newest 40, the grid sheet, reading a photo or video out; picked-movie transfer; `chatCameraClock`. |
| `ChatPhotoEditModel.swift` | The editor's state (strokes, stickers, text in the photo's own 0…1 coordinates), crop/turn, flattening, the upload and save to Photos. |
| `ChatPhotoEditor.swift`, `ChatPhotoEditorTools.swift` | The editor screen; text entry, palette, sticker sheet, crop view. |
| `ChatVideoReview.swift`, `ChatVideoExport.swift` | The video review (loop, trim) and the MP4 export. |
| `ChatCameraChrome.swift` | The dark round buttons, caption bar, green send, story Next button. |
| `ChatCameraScreen.swift` | The flow (camera → editor/review → send), its two purposes, and `NeonCameraView`. |
| `CameraScreens.swift` | Debug router ids (below). |

## The camera
- **Built.** Live preview filling the screen (black where there is no camera:
  the simulator); ✕ top leading; flash top trailing — off / on / auto on the
  back lens, off / on (the screen lights white at full brightness) on the
  front; while recording, a red dot and the time in its place.
- Strip of the newest photos and videos (videos show their length) above the
  controls, with a grabber: tap it or swipe the strip up for the grid of
  everything the app may see ("All photos" there opens the system picker).
  Tap a thumbnail to edit/send it.
- Bottom row: gallery (the system `PhotosPicker`, photos and videos, no
  permission needed), **low light** (the "magic" button — photos at the
  system's *quality* priority, which fuses frames: slower, cleaner in the dark;
  PHOTO only), the white ring shutter, the zoom button (0.5× where there is an
  ultra-wide, 1×, 2×, and the telephoto's 3×/5× where there is one; pinch the
  preview too, up to 10×), flip.
- VIDEO · **PHOTO** · VIDEO NOTE under it (selected in amber), or swipe the
  preview sideways.
- PHOTO: tap → photo; hold → video until let go (slide up while holding to
  zoom). VIDEO / VIDEO NOTE: tap to start (shutter turns to a red stop square)
  and tap to stop. A touch under half a second is not kept.
- Tap the preview to focus and expose there (amber square); it returns to
  continuous focus when the scene changes.
- Photos and videos come out level however the phone is held
  (`RotationCoordinator` on iOS 17+, the device's orientation on 16); they are
  not mirrored on the front camera (the preview is, as the system camera's).
- Photos are taken at up to 12 MP (not 48: slow, and the server keeps 2400 px),
  turned upright and kept at ≤ 4096 px for editing.
- The microphone is added to the session on the first recording, not when the
  camera opens, so taking photos never lights the microphone dot; it is asked
  for then (a first hold in PHOTO asks and records on the next hold, since the
  question would take the touch away). During a call the video is recorded
  without sound rather than taking the microphone from the call.
- Longest recording: 3 minutes (so the MP4 fits 50 MB), 1 minute for a video
  note or a story.

## Permissions
- Camera: asked when the camera opens (not on a device with none). Refused →
  a note with Open Settings; the gallery and the strip still work.
- Photos (`NSPhotoLibraryUsageDescription`, project.yml): asked the first time
  the camera opens. Limited → the strip shows what was shared plus a "More"
  tile (the system's limited-library picker), the grid says so with "Share
  more". Refused → no strip; the gallery button still opens `PhotosPicker`.
- Save (`NSPhotoLibraryAddUsageDescription`): add-only access, asked on the
  first Save.

## The editor (after a photo is taken or picked)
- **Built.** The photo full screen; ✕ (back to the camera); round tools along
  the top: **save** to Photos (with everything drawn on it), **HD**, **crop and
  rotate** (drag corners or move the frame; Free / Square / 4:3 / 3:4 / 16:9;
  turn left; Reset), **stickers** (emoji in four groups), **Aa** (text: colour,
  plain or on a box; tap a text to change it), **pencil** (ten colours, three
  weights, undo).
- Stickers and text: drag with one finger; pinch and turn with two (the one
  last touched); drag onto the bin at the foot to remove.
- Drawings and overlays are kept in the photo's own coordinates, so a crop or
  a turn carries them along; anything left outside is cut off.
- Foot: "Add a caption…" with the camera (take another) on its leading side;
  the chat's name; the big green send button.
- Not built: "view once" (the platform has no such thing), several photos in
  one go (the + menu's Photo still sends up to ten).

## Sending (the chat's own paths)
- **A photo** goes exactly as the chat sends one: `UploadFile(field: "photo")`
  through `ChatConversationStore.sendFile` — the same optimistic stand-in
  with the local picture, clock, retry — with the caption as the message's
  text and the composer's project tag. Normal: `UploadMaker.photo` (2400 px,
  JPEG 0.82, as the chat shrinks photos). HD: the photo as taken (≤ 4096 px)
  at JPEG 0.92, stepped down if it ever passed the server's 40 MB image limit
  (storage.ts `RULES.image`). The server still fits every chat photo within
  2400 px when it stores it (`compressImage`), so HD means it starts from the
  original rather than a copy already shrunk once.
- **A video** goes as the chat sends files: `UploadFile(field: "document",
  mimeType: "video/mp4")`, named `VID-yyyyMMdd-HHmmss.mp4`. It is exported to
  H.264 MP4 (`AVAssetExportSession`, `.mp4`), starting at 1280×720 and stepping
  down (960×540, 640×480, medium, low) whenever the estimate says it would
  pass 49 MB, and checking the real file — so it fits storage.ts's 50 MB
  `RULES.document`. Too long even at the lowest size → "Trim it shorter". The
  send button's ring fills while it is made; then the chat's usual stand-in
  (a file card) takes over.
- Whatever was in the composer's box opens as the caption; sending clears it.

## VIDEO NOTE — the decision
The server has no kind for a round video message, so none is invented: a
video note is **a short square video sent as a normal video**. It is recorded
on the front camera (seen through a circle, with a ring filling over its one
minute), reviewed round, and exported as a 640×640 H.264 MP4 cut from the
middle (`VIDNOTE-….mp4`, `document`). Everybody else sees it as the chat
draws any video file today.

## Stories — `NeonCameraView`
```swift
.fullScreenCover(isPresented: $showCamera) {
    NeonCameraView(purpose: .story) { image in … } onVideo: { url in … } onCancel: { … }
}
```
- The same camera with VIDEO · PHOTO (no video note), a one-minute recording,
  the editor's tools (crop, stickers, text, pencil, save) and a **Next**
  button in place of the caption, chat name and send. It dismisses itself
  after calling any of the three closures.
- `onPhoto(UIImage)`: **exactly what the full-screen preview showed** — the
  preview draws the lens's video frame (16:9, a centred cut of the 4:3 photo)
  filling the screen (a centred cut of that again), so the photo is cut to
  that region (`ChatCameraController.visibleRect`), turned with the photo
  when it was taken on its side; upright (`.up`, scale 1), ≤ 4096 px, edits
  burned in. On a 393×852 screen a 3024×4032 photo keeps x 582…2441, the
  whole height (camera-video-export shows the arithmetic). A picked photo is
  returned as it is.
- `onVideo(URL)`: an H.264 MP4 in the temporary folder (the caller deletes
  it), ≤ 1 minute (trimmable), ≤ 1280 px long: a recording cut to the
  screen's shape like the photo (the review already shows it so); a picked
  video at its own shape.
- `onCancel()`: ✕ on the camera.

## Debug router (`CameraScreens`, registered in App/DebugScreens.swift)
`camera`, `camera-note`, `camera-strip`, `camera-editor`,
`camera-editor-marked`, `camera-editor-draw`, `camera-editor-text`,
`camera-editor-crop`, `camera-editor-stickers`, `camera-editor-hd`,
`camera-video`, `camera-note-review`, `camera-video-export`, `camera-story`,
`camera-story-editor`, `camera-story-video`. The photo, the thumbnails and the
video are drawn in code; launch with `-uiTestMode` so nothing at all reaches
the network:
`xcrun simctl launch <device> com.neonjo.staff -uiTestMode -neonScreen camera-editor`.
On the iOS 26 simulator `simctl privacy grant photos` does not give full
access, so `camera` asks; revoke it (`simctl privacy … revoke photos`) for a
screenshot without the question, or use `camera-strip`.

## Only a real iPhone can confirm
The live preview and its rotation, every lens and zoom stop (0.5×, tele),
flash/torch and the front screen flash, focus on tap, hold-to-record and the
microphone question mid-hold, sound in recordings, the photo crop for stories
against what the screen showed, PhotoKit's strip, limited access and iCloud
downloads, save to Photos, and real recordings exported within 50 MB.
