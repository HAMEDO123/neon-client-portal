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
| `chat-group-new` | New group form, as the manager's header button opens it (its own sheet; from New chat it is the same form pushed, with a back button) | `members` |
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
  New group (manager) or Add to your story (team), and the ⋯ menu (add to
  story for the manager, Meetings, language, sign out). The floating button is
  the one way to a new chat. It scrolls with the page (kit rule for a tab
  root); no nav bar. The Arabic title is «المحادثات».
- **Stories and people row**: My Story first (the "+" always adds; the face
  opens my story when one is up), then every live story in a colourful ring
  (unseen) or a grey one (seen) — the ring shows the newest photo, like
  WhatsApp's updates, over the author's face — then **only the people here
  right now** (green dot) who have no story, in the list's own order; tapping
  one opens that chat. Nobody else: they are the cards just below. With no
  story and nobody here the rail is My Story alone. Presence comes from the
  same conversation `online` flags the rows use.
- **Filters**: All / Unread (red count) / Groups / Tasks / Favorites, the kit's
  pill bar look, drawn a little tighter first so all five sit on one line as in
  the mockup (English and Arabic on a 6.3" phone); narrower phones or large
  text fall back to the kit's own scrolling `PillFilterBar`.
- **Rows** (`ChatConversationCard`): white row cards (`rowCard`) with the
  pinned accent bar and a tilted pin, the streak badge (kit `BadgeView`, from
  3 days), a star for favourites, the time (accent when unread: "10:24 AM",
  "Yesterday", a weekday, "Sep 10", a year only before this one) and chevron; under it the sender prefix in ink
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
- **Tasks filter**: task cards with a state tile, title, conversation and a
  short due ("Due Sep 16, 7 PM", red when overdue, gone once Done), the card's
  state badge ("Sent for review" until the manager says Done) and each
  person's part as a chip in its state's colour with the state's symbol.
- **Swipe / context menu**: pin (leading), favourite and mute (trailing), same
  optimistic update and roll-back; the context menu adds **Group info** for
  custom groups.
- **Empty, loading, error, offline**: the kit's `EmptyState(card:)` per filter
  with the old wording, `SkeletonRows`, `ErrorState` with Retry, `OfflineBanner`.
- **Story player**: segmented bars, author with a story ring, "2h ago · 1 of 3"
  and a video mark, a frosted ✕ alone at the top, a photo fitted over its own
  blurred, dimmed fill (no black bands), the caption on a frosted card, the
  author's frosted "N views ⌃" (opens the viewers sheet) with a ⋯ beside it
  holding Delete story (still confirmed), and for everybody else a
  **Message <name>** capsule that closes the viewer and opens that chat. A press held past a tap shows a pause badge;
  a load failure is the kit's orange tile.
- **Viewers sheet**: kit `SheetHeader`, one `CardList` of faces with how long
  ago, an honest empty state.
- **Composer**: `SheetScaffold` ("The studio sees it for 24 hours") with two
  big colour tiles (camera pink, library indigo), a one-line eye note that only
  the author sees viewers, the caption in a `FormSection`, a Photo/Video tag on
  the preview.
- **New chat**: `SheetHeader`, the New group tile (manager), kit search, the
  people in one card with their studio colours and green dots, a plain chevron
  on each (the whole row opens the chat).
- **New group / Add members**: the same sheet language as New chat — kit
  `SheetHeader` (a back button beside it when New group is pushed from New
  chat), no system bar. New group: a soft indigo group tile in a dashed circle
  until a photo is picked (no story ring, no colour that changes as you type),
  the name field's card on its own, then Members, chosen people as removable
  `PersonChip`s, everybody in one card with `CheckCircle`s. The foot says what
  is missing ("Name the group", "Pick at least one person", "Pick people to
  add") on a readable grey bar, and becomes the kit's indigo primary button
  ("Create group with 3", "Add 2") once it can act.
- **Group info**: a brand-gradient hero (photo in a white ring — changeable
  by the manager — name, member count, avatar stack), rename in a `FormSection`, members in a
  `SectionCard` with an "Add" capsule and remove buttons, delete at the bottom
  (still confirmed).
- **Live**: the 15-second read of the list is unchanged, ticks refresh with it,
  and stories now refresh every fourth round (once a minute) instead of only on
  appear.

## Round 2 — the critic's review of the live screenshots

1. **Empty filters** (Unread blank, Favorites half-faded): the kit's
   `EmptyState` fades in and floats its tile on a repeat-forever animation,
   both started on appear; in a List row the fade got caught in the repeat.
   The empty-state row now carries `.transaction { $0.animation = nil }`
   (`chatListStill()`), so all five (Unread, Groups, Tasks, Favorites, No
   matches) are drawn settled: ink title, white card, pastel tile. The kit's
   `NeonFloat` itself is untouched (kit, not this area).
2. **New group** hides the system bar and pins the kit `SheetHeader` ("Name
   it, add a photo, pick who is in", person.3 tile) over its scroll, with a
   round back button when pushed from New chat. The manager's header button
   opens it in its own sheet (`ChatNewGroupSheet`), which reads the people
   itself.
3. **Disabled buttons**: no more faded gradient. Until the form can act, the
   foot is a grey bar in secondary text saying what is missing; ready, it is
   the kit's `.primary` button with person.3.fill / person.badge.plus.
4. **Plurals**: `ChatList.stringsdict` (Arabic zero/one/two/few/many/other)
   for views, people, members and the streak's spoken label; English picks
   "view"/"views" by key. `ChatCount` formats in the app's language —
   `L(_:_:)` formats with no locale, and a stringsdict then picks its form by
   English rules. Checked against the built bundle: 2 «مشاهدتان», 3
   «3 مشاهدات», 11 «11 شخصًا», 103 «103 أعضاء».
5. **Group photo** while making one: soft tile, dashed circle, no story ring,
   no name-hashed colour (it changed on every keystroke).
6. **Rail**: My Story, live stories, then only people online now; groups and
   everyone else dropped (they are the cards below). `ChatStudioMark` has a
   `neonLine` hairline instead of a white border.
7. **Streak**: kit `BadgeView` (flame, orange; clock, warning when today still
   needs a message), from 3 days; no emoji.
8. **Task parts**: state symbol on the state's wash, not a presence-looking
   green dot; no due line on a Done card; the due is "Sep 16, 7 PM".
9. **One way to each thing**: FAB = new chat; header = New group (manager) or
   Add to your story (team); "New group or chat" is gone from ⋯.
10. **Composer**: one-line subtitle, the grey clock tile is a one-line
    `MetaLabel` with an eye; header glyph plus.circle (not sparkles).
11. **New chat rows**: a faint chevron instead of the indigo bubble tile.
12. **New group headings**: the "GROUP" label is gone; the name card stands
    alone above the Members `SectionHeader`.
13. **Times**: "Sep 10" / «10 سبتمبر» within the year, weekday within the
    week, never a numeric date (`chatListTime`).
14. **Title**: «المحادثات» in the header (the shared "Chat" key reads
    «المحادثة» from Localizable.strings, searched first; so the header asks
    for "Chats" in Arabic). The **tab label** is the shell's
    (`NeonAdminApp.swift`, Localizable.strings) — not changed here.
15. **Story viewer**: blurred fill behind a fitted photo; Delete moved into a
    ⋯ at the foot beside the views capsule; ✕ alone at the top.

Not done here: the system tab bar's look (16, shell-wide, not this area's
files) and seeding a custom group and another person's live story for the
group-info and viewer shots (17, needs the live studio, which this area has no
sign-in for).

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
