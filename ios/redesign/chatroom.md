# Chat room — redesign notes

Branch `ux-chatroom` (from `ux-base2`). Built on the kit in `ios/Sources/UI/`;
every new string is in `ios/Resources/ar.lproj/ChatRoom.strings`.

## Screens and sheets (debug router ids)

| Id | What | Scroll anchors |
|---|---|---|
| `chat-room-team` | The team's conversation | `top` (oldest loaded messages) |
| `chat-room-direct` | The first private chat in the list (DebugAsync) | `top` |
| `chat-room-group` | The first group the manager made (says so on a warning card if there is none) | `top` |
| `chat-room-search` | The team's conversation with the search box open | — |
| `chat-room-cards` | The newest real task and meeting cards from any chat, drawn exactly as the room draws them, on the room's wallpaper | — |
| `chat-meetings` | Meetings (every meeting card, pushed from the chat list and More) | `coming-up`, `earlier` |
| `chat-task-compose` | + → Task sheet, as a screen | — |
| `chat-meeting-compose` | + → Meeting sheet, as a screen | — |
| `chat-assistant` | Ask the assistant sheet, as a screen | — |

## What changed

- **Header.** The system bar is hidden and the room draws its own
  (`ChatRoomHeader.swift`), in a VStack above the messages — so nothing floats
  over them any more (the baseline's glass capsule sat on top of bubbles).
  Back, the picture (studio mark for the team), the name, and a status line
  that crossfades between: *typing…* (with live dots), *online now* (green dot),
  *Last seen 5 min ago* (the web's own `lastSeenLabel` wording, from the
  receipts snapshot's `seenAt`; nothing when never seen), and in a group
  "5 people · 2 here". Round white 44 pt buttons: back, the calls area's
  `CallButtons` on a white 44 pt capsule, and search — or, in the team for
  the manager, a ⋯ menu holding search and the assistant.
  A group the manager made opens its info from the name (chevron shows it).
  The edge swipe back is kept (`ChatRoomSwipeBack`, restored on leaving).
- **Wallpaper.** The app's lavender page with a very faint, fixed pattern of
  the studio's own things (rooms, rulers, lamps, sofas). Messages fade out at
  the top and bottom edges instead of being cut.
- **Bubbles.** WhatsApp-style tail at the top of the first bubble of a run;
  every bubble keeps the tail's width so a run lines up; tighter spacing inside
  a run, more between runs. Mine: the kit's indigo → violet (`neonAction`);
  others': white with a hairline; the assistant's answers: a purple wash with
  sparkles. Time and ticks inside the bubble, same rules as before (grey
  sent/delivered, green read on white bubbles, white on my own violet ones,
  clock sending, red failed). Big emoji (1–3, emoji
  only) drawn without a bubble. In groups, the author's initials beside the
  first bubble of a run and their name in their colour — the colour the
  studio gave them, the same as in the chat list (see round 2).
- **Date chips** — white capsules: Today, Yesterday, "Monday, September 28".
- **Photos** — frameless, rounded, soft shadow, time/ticks on a shade; grids of
  four or more unchanged in behaviour.
- **Reactions** — white pills tucked against the bubble's lower edge; your own
  tinted indigo; pop in.
- **Voice notes** — play/pause disc, **bars read from the recording itself**
  (decoded once, cached in memory; flat and quiet until read — never a made-up
  pattern), filling as it plays, time counting while playing. Loading spinner
  while the note is fetched; a toast if it can't play. Recording shows the
  microphone's **live level** (real metering) beside the timer.
- **Files** — a tile per kind (PDF red, sheets green, drawings cyan…), name, size.
- **Calls** — a white chip across the conversation with a coloured tile, said
  from the viewer's side (red only for a call the viewer missed).
- **Task card** — white card with a purple top edge, pastel tile, TASK,
  title, description, overall state (unless one person is on it) + priority
  badges, due (red when overdue),
  the card's attachment (it was never shown before), each person's part with
  their initials and state; the manager's Review → note → Approve / Send back
  and the assignee's **Send proof** (brand button) are unchanged in rules. The
  comment thread has avatars and a round send button. Failures now say so
  (toast) instead of being silently dropped.
- **Meeting card** — cyan top edge, a calendar-leaf date tile, MEETING, title,
  agenda, time and place, a "Starting soon" / "Now" strip holding Join (the
  calls buttons) inside the join window, each attendee's answer as a badge —
  *Not answered yet* is grey, never a no — Coming / Not coming, and the
  manager's cancel (confirmed).
- **Composer** — floating: + (camera, photo, file, project tag, and for the
  manager Task and Meeting), a white capsule box with a camera button while
  empty, and a gradient button that morphs mic ⇄ send. Quick replies are white
  chips over it, for the team only (see round 2); the project tag and a send
  error are chips above it.
- **Back to the newest** — a round white button with a red count of what
  arrived meanwhile.
- **Loading** — shimmering bubble placeholders; the conversation fades in once
  it has settled at its newest message (no visible jump from the top). Pinned
  message jumps now light the row they land on for a moment.
- New bubbles rise in (others' arrivals and my own sends); a sent message
  being swapped for the server's copy is deliberately not animated.
- **Meetings** — NeonScroll, the floating "Set a meeting" button (manager),
  a "Coming up" SectionCard with the empty state in it, kit section headers
  with counts once there are meetings, each meeting as a row card with the
  date leaf, meta labels, answer chips and Join / Answer buttons.
- **ChatTaskRow** (used by the Tasks area's manager list) — row card with tile,
  state badge, conversation, due and people chips. Same API.
- **Ask the assistant** — the same SheetScaffold + FormSection as the task and
  meeting sheets, sticky Ask button, the website's prompt and suggestions.

## Deliberately kept

- Every rule of the store (merging, sending in order, retry/discard, ticks,
  marking read, typing cadence) — ChatConversationStore, ChatStream, ChatAPI
  and ChatModels are untouched.
- Tap the mic to record, tap send to send (not hold-to-record): the existing
  interaction.
- The quick replies' shape: emoji then words, as the website sends them
  (the words now in the app's language).
- Nobody marks their own work done: the assignee's only move is proof; Done
  stays the manager's review.
- Offline: the composer stays disabled and the banner says why.

## Open issues

- No live check: I had no sign-in. The pieces were checked on NEON QA 04 in
  English and Arabic through an in-memory lab screen that was never committed.
  Real conversations (long Arabic threads, real voice notes, real cards) need
  the orchestrator's live shots.
- The header wraps the calls area's `CallButtons` in a white capsule. If the
  calls redesign turns them into white discs themselves, drop the capsule.
- A voice note's bars need its file: each note is fetched once when it scrolls
  into view (small m4a), then cached in memory with the player sharing it.
- The chat list area owns `ChatStudioMark`, `ChatGroupInfoSheet`, `ChatRoute`
  — used as they are.

## Round 2 — after the critic's review of the live shots

- **Task and meeting defaults inside the working day.** `ChatWorkingDay`
  (ChatCompose.swift) ports `defaultDue` (lib/chat-tasks.ts: today's end if an
  hour of it is left, else the next working day's end) and `defaultWhen`
  (lib/chat-meetings.ts: the next half hour if a 30-minute meeting still fits
  today, else the next working day's start), from the hours Settings edits
  (`ops/settings` → `workHours`), falling back to the platform's
  DEFAULT_WORK_HOURS (Sun–Thu 11:00–19:00) until that answers. A date the
  manager has already changed is never moved. The pickers keep `now` as the
  lower bound.
- **Quick replies.** Only for the team (the website shows them on its studio
  side only): the manager is no longer offered "Need review". Each chip is the
  kit chip shape with its SF Symbol in its hue, 36 pt tall with a 44 pt target,
  the row inset by the gutter and bled to the screen edges. The words go
  through L() (تمام / شغّال عليها / رح أحدّثك / بدها مراجعة) and are sent as
  "👍 تمام" in Arabic — emoji first, as the website sends them.
- **Call lines** are built from `call.endReason`, `call.kind` and the
  message's own duration, through L(): my own unanswered call is "No answer ·
  You", grey, with an outgoing-call glyph; red is kept for a call I missed.
  A line older than `endReason` still shows the server's words.
- **Opening at the newest.** A photo that learns its shape now re-pins after
  the new height is laid out (it used to jump before, landing a photo's growth
  short), and does so while the room is still settling after opening even if
  the tracker has not measured it yet. iOS 17+ also opens at the bottom
  through `defaultScrollAnchor` (initial offset only, so a reader scrolled up
  is never moved).
- **People's colours** (ChatRoomPeople.swift): the room reads `chat/people`
  and draws authors, the typing bubble, the pinned strip, task assignees and
  comments and meeting attendees through the chat list's own `ChatTint` /
  `ChatAvatar`, keyed by employee id ("admin" for the manager, who is ink);
  the header uses the list's face for the conversation. The same person is
  the same colour in the list and the room. `ChatTaskRow` uses the assignee's
  own `color`. (The kit's AvatarView was not given a `colorKey:` — the kit is
  not this area's to edit — so the room uses the list's avatar instead.)
- **Header.** Back is a 44 pt round button; search / the ⋯ menu are 44 pt; the
  call capsule is 44 pt tall. The group line is a count in `.neonSubtitle`.
- **Top edge.** Messages fade over 30 pt under the header instead of 14.
- **Task card.** Pastel tile, title on the same side as TASK (`fill: false`),
  overall badge hidden with one person on the card, due as "Wed, Sep 16 ·
  7:00 PM" (year only when not this one; meetings use the same), a comment
  under its author's name on the leading side.
- **Meetings.** FAB instead of the brand button; no account menu on this
  pushed page; "Coming up" is a SectionCard with the empty state in it; the
  empty state tells the manager where to set one; the sheet opened here says
  where the meeting is posted ("Posted in NEON Team", the team's real title);
  the 200-message footnote shows only when a chat really was cut
  (`ChatCardsLoader.truncated`), as an info StatusNote.
- **Sheets.** Title prompts are examples; the meeting sheet's title and
  button both say "Set a meeting"; People comes straight after Starts. Ask the
  assistant is a SheetScaffold with one subtitle (no second note), curly
  quotes, the website's prompt, and its two suggestions as chips that fill the
  box.
- **Voice notes** show their length ("0:12", `.neonMeta`, monospaced digits)
  read from the downloaded file when the server sent no `durationSeconds`;
  "Voice message" is the accessibility label only.
- **Project tag** is one capsule with `folder.fill` at the top of a bubble on
  either side, and a frosted capsule over a photo's top-leading corner.
- **Ticks** on my own violet bubbles: read is solid white, sent/delivered
  white at 55 %; green stays on white bubbles and in the list.
- **Missing fixtures** (`chat-room-direct`, `chat-room-group`) show a warning
  EmptyState on the app's page instead of plain text on white.

### Skipped in round 2

- Sizing photo placeholders from the server's width and height: the server
  sends no dimensions for chat photos, and this area adds nothing to the
  server. The placeholder stays square until the photo arrives; the re-pin
  above covers the growth.
- Creating a test group on the studio server so `chat-room-group` can be
  shot: this agent has no sign-in to the live studio and must not use it.
  Somebody with access has to make one (Chat → new group), then reshoot.
- Shortcuts for the manager in place of the quick replies: the website gives
  the manager none, so none were invented.
- The inner call and video buttons stay the calls area's 36 pt ones
  (`CallButtons` in Calls/CallStubs.swift); the capsule around them is 44 pt.
