# NEON in the share sheet (`NeonShare`)

WhatsApp, Photos, Files, Safari… → **Share** → **NEON** → tick one or more
chats (a person, the team, a group) → optional caption → **Send**. Each chosen
chat gets what was shared as attachments, exactly as if it had been sent from
the app's own chat.

| | |
|---|---|
| Target | `NeonShare` (app extension), embedded in `NeonAdmin.app/PlugIns` |
| Bundle id | `com.neonjo.staff.share`, team `745F9U99BC`, automatic signing, iOS 16 |
| Extension point | `com.apple.share-services`, principal class `ShareViewController` (UIKit, hosting SwiftUI) |
| Shows as | "NEON", with the app's icon |
| Appears for | up to 10 images, 5 videos, 10 files (any type), plain text, one web link. It sends at most 10 attachments in one go. |
| Version | `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` are project-level in `project.yml`, so the extension always matches the app (App Store Connect refuses a mismatch). |

## Files

- `ShareViewController.swift` — the entry point; reads the session and hosts the screen.
- `ShareModel.swift` — state: the attachments, the list, what is ticked, the send (resumable: a retry never sends anything twice).
- `ShareItems.swift` — taking attachments off the host app (`ShareInbox`) and making them what the server keeps (`ShareConverter`, `ShareRules`).
- `ShareAPI.swift` — the three calls.
- `ShareViews.swift`, `ShareFaces.swift` — the screen, in the kit's look; faces as the chat list draws them.
- `ShareLanguage.swift` — `AppLanguage` and `L` for the extension; `ar.lproj/Share.strings` and `Share.stringsdict`.
- Also compiled into the extension, unchanged: `Sources/UI/Tokens.swift`, `Sources/UI/DesignSystem.swift`, `Sources/Core/Formatting.swift` (the kit's colours, surfaces, motion, `resolvedMediaURL`) and `Sources/Core/TokenStore.swift`. **Keep them extension-safe** (no `UIApplication.shared`, nothing from the rest of the app); if they start using a new `AppLanguage` member, add it to `ShareLanguage.swift`.

## The session: a shared keychain group, not an App Group

- Both targets have `keychain-access-groups: [$(AppIdentifierPrefix)com.neonjo.staff.shared]` (generated entitlements, git-ignored, from `project.yml`). Info.plist carries the same name as `NeonKeychainGroup` (`$(DEVELOPMENT_TEAM).com.neonjo.staff.shared` — this team's App ID prefix is its team ID) for `TokenStore` to use.
- `TokenStore` (one file, both targets) keeps the token there: service `com.neonjo.staff`, account `session_token`, `AfterFirstUnlockThisDeviceOnly`. Nothing goes in UserDefaults, a file or an App Group.
- **Update path:** installs from before this kept the token in the app's own group. On the app's next launch `TokenStore.read()` finds it there, adds it to the shared group, and only then deletes the old copy. So after updating, **the app has to be opened once** before sharing works; until then the extension says "Open NEON and sign in first".
- **Sign-out** deletes the item from every group the app can reach (the shared one named outright), so the extension is signed out with it. A 401 in the extension says so and leaves the session to the app.
- A build without the entitlement (the unsigned CI IPA) cannot add to the group; `write` then falls back to the app's own group, so the app still stays signed in — only sharing is unavailable there.
- Keychain sharing needs nothing registered on the developer portal (profiles already allow `745F9U99BC.*`). The new **App ID** `com.neonjo.staff.share` does: the first signed archive with `-allowProvisioningUpdates`, by an Xcode account (or App Store Connect API key) in team 745F9U99BC, registers it and makes its profiles.

The extension does not need the app's `Identity` (it lives in the app's UserDefaults): every route it calls finds the side from the token.

## What is sent

| Shared | Goes as | How |
|---|---|---|
| Text, a web link | a text message | `POST api/mobile/chat/messages`, JSON `{conversation, body}`. The text is put in the message box first, to edit. |
| Photos (any image: HEIC, PNG, WebP…; also images shared as files) | `photo` | fitted within 2400 px, JPEG 0.82, upright, metadata dropped, transparency on white — what the app's chat sends (`UploadMaker.photo`). Decoded straight to that size with ImageIO, never at full size. |
| Videos | `document`, `video/mp4` | an MP4 of ≤ 50 MB goes as it is; anything else (an iPhone's HEVC `.mov`, a long clip) is re-encoded as H.264 MP4 at the largest of 1080p / 720p / 540p / 480p that fits 50 MB, or refused. |
| Documents | `document` | the type from the extension, as the app does; DWG, DXF, SKP, RVT and other drawings as `application/octet-stream`, which is what the server's rule takes for them. |

Multipart fields are the app's `sendAttachment` ones, read by the server's `readChatAttachment`: `conversation`, `body` (the caption — on the **first** attachment each chat receives only), and one file as `photo` or `document`. With several chats ticked, each attachment is prepared once and sent to each chat in turn, so every chat gets them in order. A caption with nothing sendable goes as a text message.

**Limits (the server's `src/lib/storage.ts`)** are checked before anything uploads, so a refusal is explained on the spot: documents must be PDF, DOC/DOCX, XLS/XLSX, ZIP, MP4, JPEG/PNG/WebP or a generic file (CAD), ≤ 50 MB; photos ≤ 40 MB (ours are a few MB). Refused on the phone: PPTX, Keynote/Pages/Numbers, plain `.txt`, folders, anything over 50 MB.

**Voice notes** (a WhatsApp `.opus`, a Voice Memos `.m4a`, MP3, WAV…) go as the `voice` field, ≤ 15 MB, exactly like a recording made in the app. CAF/AIFF/AMR are written out as M4A first; M4A/MP3/WAV carry their `durationSeconds`. An Ogg/WebM one is sent as it is — the phone cannot read it — and the server turns it into AAC and measures it (`src/lib/voice-transcode.ts`, needs `ffmpeg`, which the Dockerfile installs). The server's own sentence is shown for anything it refuses anyway.

Memory: an extension is killed at a small fraction of an app's memory. Attachments are taken as files (`loadFileRepresentation`) into the extension's `tmp/NeonShare/`, handled one at a time, and each upload is streamed from a multipart body written to disk. The folder is cleared on launch and on finishing.

## Gotchas found while building it

- `NSItemProvider.hasItemConformingToTypeIdentifier` also answers yes **the other way round**: a provider of a web link "has" `public.file-url`. Conformance is checked on `registeredTypeIdentifiers` instead.
- A file whose extension the phone has no type for (`.dwg` on many iPhones) is registered under a **dynamic type that conforms to nothing**, not even `public.data`. Taking "the first type that conforms to data" picked the `public.file-url` entry and uploaded 262 bytes of link called "file URL".
- Without a `suggestedName`, the copy `loadFileRepresentation` hands over is called something generic ("PDF document.pdf"); the file URL's own name is used instead.
- An `NSURL` asked for with `loadItem` arrives as an archived property list; load it with `loadObject(ofClass: URL.self)`.

## Checked here, and what only an iPhone can check

Checked in the simulator, with no network to the studio: the keychain update path (old install → update → extension sees it; sign-in again; sign-out signs the extension out; a build without the entitlement stays signed in), with the real `TokenStore`; the whole attachment path with real `NSItemProvider`s (HEIC on its side, MOV, HEVC, MP4, PDF, PPTX, DWG, transparent PNG, a 60 MB ZIP, text, a link) through conversion and multipart to a stand-in server, byte for byte; the screen's send against it — caption on the first item per chat, a failure resumed without duplicates, a refused file skipped; and the screen itself in English and Arabic.

On a real iPhone (TestFlight):

1. NEON appears in the share sheet from Photos, Files, Safari and **WhatsApp** (media from a chat, a forwarded document, a text message) — WhatsApp's providers can only be seen there.
2. After updating over an installed build: open NEON once, then share — no sign-in asked. Sign out in the app → the extension says to sign in.
3. A long 4K video from Photos (iCloud download, the re-encode time, the 50 MB cap) and a slow connection: the progress, Cancel mid-send, and Retry.
4. Ten full-size photos at once, without the extension being killed for memory.
5. The phone in Arabic: the sheet right to left, Arabic strings.
