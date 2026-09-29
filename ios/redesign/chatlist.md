# Chat list — redesign notes (branch `ux-chatlist`)

Rebuilt on the design kit (`ios/Sources/UI/`) to match the owner's chat mockup
(`ux-mockups/chat-mockup.jpg`, kit slice 4). Every feature, action and path of
the old list is still here; nothing on the server changed.

## Screens and sheets (debug router ids)

Open any of them with `-neonScreen <id>`; long ones take `-neonScroll <anchor>`.

| Id | What | Anchors |
|---|---|---|
| `tab-chat` (existing) / `chat-list` | The list itself (tab root) | `stories`, `filters`, `end` |
| `chat-list-unread`, `chat-list-groups`, `chat-list-tasks`, `chat-list-favorites` | The list opened on that filter | same |
| `chat-list-search` | The list with search open and the cursor in it | same |
| `chat-new` | New chat sheet (manager: with the New group tile) | `people` |
| `chat-group-new` | New group form (pushed inside the new chat sheet) | `members` |
| `chat-group-info` | Group info sheet (first custom group; opened from the room and now also from a group row's context menu) | `members`, `delete` |
| `chat-group-add-members` | Add members sheet | — |
| `chat-story-new` | Story composer | — |
| `chat-story-player` | Story viewer on everybody else's rings — a still: nothing is marked seen, nothing advances | — |
| `chat-story-player-mine` | Story viewer on my own ring (delete, views) — same still | — |
| `chat-story-viewers` | Who saw my newest story | — |

The player and viewers ids need a live story on the server; with none, the
router says "Nothing on the server to open this with."

## What changed

- **Header**: the kit's `ScreenHeader` — the studio's round mark, "Chat", and
  round white `IconButton`s for search (turns into a filled ✕ while searching),
  new chat / group, and the ⋯ menu (add to story, new chat, Meetings, language,
  sign out). It scrolls with the page (kit rule for a tab root); no nav bar.
- **Stories and people row**: My Story first (the "+" always adds; the face
  opens my story when one is up), then every live story in a colourful ring
  (unseen) or a grey one (seen) — the ring shows the newest photo, like
  WhatsApp's updates, over the author's face — then **the rest of the studio's
  people and groups** as plain faces with green dots, in the list's own order;
  tapping one opens that chat. Presence comes from the same conversation
  `online` flags the rows use.
- **Filters**: All / Unread (red count) / Groups / Tasks / Favorites, the kit's
  pill bar look, drawn a little tighter first so all five sit on one line as in
  the mockup (English and Arabic on a 6.3" phone); narrower phones or large
  text fall back to the kit's own scrolling `PillFilterBar`.
- **Rows** (`ChatConversationCard`): white row cards (`rowCard`) with the
  pinned accent bar and a tilted pin, the streak badge, a star for favourites,
  the time (accent when unread) and chevron; under it the sender prefix in ink
  ("You: ", "Ahmed: ") and the message in grey, laid out in the line's own
  direction; the muted bell, and the red unread count (grey when muted).
- **Ticks on my last message** (new): read from the existing `chat/receipts`
  snapshot through `ChatReceiptBoard` — the rule the room draws its own ticks
  with — one conversation at a time, only where the last message is mine, and
  never re-asked once everybody has read it. No answer → no ticks (never a
  guess); a saved offline answer is not used. `ChatListTicks.swift`.
- **Faces**: `/api/avatar?name=…&color=…` (the server's generated initials) is
  now drawn natively in the studio colour it names — same colours as the web,
  crisp, no download; real photos still load. Groups without a photo (the
  server sends the studio icon) get a group glyph on their own colour instead
  of the studio's logo, which now belongs to the team alone.
- **Tasks filter**: task cards with a state tile, title, conversation and due
  (red when overdue), the card's state badge ("Sent for review" until the
  manager says Done) and each person's part with its state dot.
- **Swipe / context menu**: pin (leading), favourite and mute (trailing), same
  optimistic update and roll-back; the context menu adds **Group info** for
  custom groups.
- **Empty, loading, error, offline**: the kit's `EmptyState(card:)` per filter
  with the old wording, `SkeletonRows`, `ErrorState` with Retry, `OfflineBanner`.
- **Story player**: segmented bars, author with a story ring, "2h ago · 1 of 3"
  and a video mark, frosted kit buttons (delete for the author, close), the
  caption on a frosted card, the author's frosted "N views ⌃" (opens the viewers
  sheet), and for everybody else a **Message <name>** capsule that closes the
  viewer and opens that chat. A press held past a tap shows a pause badge;
  a load failure is the kit's orange tile.
- **Viewers sheet**: kit `SheetHeader`, one `CardList` of faces with how long
  ago, an honest empty state.
- **Composer**: `SheetScaffold` with two big colour tiles (camera pink, library
  indigo), a note that stories go by themselves after 24 hours and only the
  author sees viewers, the caption in a `FormSection`, a Photo/Video tag on the
  preview.
- **New chat**: `SheetHeader`, the New group tile (manager), kit search, the
  people in one card with their studio colours and green dots.
- **New group / Add members**: photo in a story-gradient ring, name in a
  `FormSection`, chosen people as removable `PersonChip`s, everybody in one card
  with `CheckCircle`s; "Create group with 3".
- **Group info**: a brand-gradient hero (photo — changeable by the manager —
  name, member count, avatar stack), rename in a `FormSection`, members in a
  `SectionCard` with an "Add" capsule and remove buttons, delete at the bottom
  (still confirmed).
- **Live**: the 15-second read of the list is unchanged, ticks refresh with it,
  and stories now refresh every fourth round (once a minute) instead of only on
  appear.

## Deliberately kept

- The List (not a `NeonScroll`): swipe actions need it.
- Every string that existed; `ChatList.strings` repeats the ones this area uses
  from other tables so a change there cannot leave the list untranslated.
- `ChatTint.pair(name:color:)`, `ChatStudioMark`, `ChatGroupInfoSheet(slug:…)`
  and `ChatRoute`, which other areas call, keep their signatures. `ChatTint` is
  now built on `NeonHue` (same families, same order), so a person keeps their
  colour.
- Notification deep links, the unread badge callback, the presence heartbeat,
  sign out, language toggle, Meetings.

## Open issues

- "Mute" resolves to Calls.strings' «كتم الصوت» (tables are searched in name
  order); acceptable, but «كتم الإشعارات» would read better for a chat.
- The rail's own face for an employee's My Story (no story up) is their
  initials in a stable colour, not the studio colour — the list has no read of
  one's own colour.
- Ticks cost one `chat/receipts` read per conversation whose last message is
  mine and not yet read by everybody, every 15 s while the list is open. A
  batched server read would be cheaper; not done, to keep the server untouched.
