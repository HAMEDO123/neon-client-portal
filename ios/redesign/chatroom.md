# Chat room — redesign notes

Branch `ux-chatroom` (from `ux-base2`). Built on the kit in `ios/Sources/UI/`;
every new string is in `ios/Resources/ar.lproj/ChatRoom.strings`.

## Screens and sheets (debug router ids)

| Id | What | Scroll anchors |
|---|---|---|
| `chat-room-team` | The team's conversation | `top` (oldest loaded messages) |
| `chat-room-direct` | The first private chat in the list (DebugAsync) | `top` |
| `chat-room-group` | The first group the manager made (DebugAsync; says so if there is none) | `top` |
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
  receipts snapshot's `seenAt`; nothing when never seen), and in a group the
  members' names, who is here first. Round white buttons: assistant (team,
  manager only), search, and the calls area's `CallButtons` on a white capsule.
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
  sent/delivered, green read, clock sending, red failed). Big emoji (1–3, emoji
  only) drawn without a bubble. In groups, the author's initials beside the
  first bubble of a run and their name in their colour.
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
- **Calls** — a white chip across the conversation with a coloured tile (red when missed).
- **Task card** — white card with a purple top edge, filled tile, TASK,
  title, description, overall state + priority badges, due (red when overdue),
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
  chips over it; the project tag and a send error are chips above it.
- **Back to the newest** — a round white button with a red count of what
  arrived meanwhile.
- **Loading** — shimmering bubble placeholders; the conversation fades in once
  it has settled at its newest message (no visible jump from the top). Pinned
  message jumps now light the row they land on for a moment.
- New bubbles rise in (others' arrivals and my own sends); a sent message
  being swapped for the server's copy is deliberately not animated.
- **Meetings** — NeonScroll, brand "Set a meeting", kit section headers with
  counts, each meeting as a row card with the date leaf, meta labels, answer
  chips and Join / Answer buttons; empty state on a card.
- **ChatTaskRow** (used by the Tasks area's manager list) — row card with tile,
  state badge, conversation, due and people chips. Same API.
- **Ask the assistant** — laid out as one sheet (it was two loose views), with
  a note saying plainly that only the manager sees the question and answer.

## Deliberately kept

- Every rule of the store (merging, sending in order, retry/discard, ticks,
  marking read, typing cadence) — ChatConversationStore, ChatStream, ChatAPI
  and ChatModels are untouched.
- Tap the mic to record, tap send to send (not hold-to-record): the existing
  interaction.
- The quick replies' exact texts (they are sent verbatim, as the website does).
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
