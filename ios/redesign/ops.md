# Ops area — redesign progress

Branch `ux-ops`, worktree `/Users/hamedsamir/neon-wt/ux-ops`. Files owned:
`ios/Sources/Features/Ops/` and `ios/Sources/Features/WhatsApp/`.

The area's code was already built on top of the kit's components (`NeonCard`,
`ListRow`, `StatGrid`, `SheetScaffold`, `FormSection`, …) before this pass —
the work here is bringing it up to the kit's *upgraded* visual language
(hues, `SectionCard`, motion) and closing the remaining gaps: hand-rolled
pieces that predated the kit's `ListCardRow`/`IconTile`/`AvatarView`, missing
debug-router ids, and missing scroll anchors.

## Screens and sheets covered

| Screen / sheet | Router id | What changed | What stayed |
|---|---|---|---|
| Attendance (device, sync, enrolled, pairing, wipe, month grid) | `ops-attendance` | Every card that was `NeonCard { SectionHeader(...); … }` became `SectionCard` (icon tile + hue): device status (green when reachable, grey when not), sync (blue), enrolled people (purple, with the Add button moved to the card's own trailing slot), pairing (indigo). Added `ScrollViewReader` + `.debugScroll` + a `.id("month")` anchor on the month header for `-neonScroll month`. `neonAppear`/staggered entrance on the five top cards. | Every read, every write (sync, set clock, add/remove/pair a device user, wipe with typed `WIPE`), the "empty cell means nothing was recorded" note verbatim, the month nav, the manual-correction flow. |
| One person's month (drill-down) | `ops-attendance-person` (new; `DebugAsync` loads the real first row from `opsAttendanceMonth`) | Registered in the debug router — it wasn't reachable by id before. No visual changes beyond what the kit already gave it (`StatGrid`, `CardList`). | Everything: the correction sheet, "add a correction" toolbar button, the day-by-day list. |
| Attendance correction sheet | (opens from the screen above) | Swapped the bare `DatePicker` for the kit's `DateField`, so it gets the same field chrome, RTL and error slot as the rest of the form. | MANUAL semantics, the remove-record confirm, both fields clamped server-side. |
| Requests (today's reports, supply requests, decided) | `ops-requests` | Report cards get a real `AvatarView` (initials, hue by name) instead of no leading mark; supply request cards get an `IconTile` (pink when urgent, orange otherwise) instead of a bare text row. Added `ScrollViewReader`/`.debugScroll` with `.id` anchors on all three section headers (`reports`, `pending`, `decided`), and staggered entrance on both card lists. | Approve/Decline/Mark bought, the decision-note sheet, "hasn't written today's report yet" wording. |
| Site visits (manager read-only; team member's diary) | `ops-sitevisits` | Both the manager's read rows and the team member's edit rows get an `IconTile` whose hue now carries the same meaning everywhere: orange for "not written up yet", cyan for "coming up", green/red for a settled visit, grey for called off. Scroll anchors on all three/two groups; staggered entrance. | The three-way grouping, "not written up yet" wording (never "missed"), required report text for VISITED/MISSED, optional for CANCELLED, edit/delete only while PLANNED. |
| Settings (push, working day, planning notes, automation, WhatsApp status, timezone, integrations) | `ops-settings` | Every card converted from the deprecated `NeonCard`+floating-`SectionHeader` pattern to `SectionCard` with a hue per topic (amber push, blue working day, purple planning notes, cyan automation/timezone, green WhatsApp, indigo integrations); the automation card's "Add" button and the WhatsApp status badge moved into the card's own `trailing` slot instead of sitting in a separate header. Scroll anchors on `push`, `workingday`, `automation`, `integrations`. | Every field and action: automation CRUD + studio-wide switch + write-nothing preview, working-day save, planning notes save, timezone save, the link into `ProcessSettingsView()` and into the WhatsApp area's own settings. |
| WhatsApp inbox | `whatsapp` | The hand-rolled circle+icon row became a real `ListCardRow` (group → `IconTile` in green, person → `AvatarView` with the mockup's solid-colour initials), which also gets the kit's red unread badge instead of a green one, matching how the mockup emphasises unread. | Search, 20s auto-refresh, pull-to-refresh, "not linked yet" vs. generic-error distinction, read-only groups. |
| WhatsApp thread | (opens from a chat) | Header's hand-drawn circle became `IconTile`/`AvatarView`. | Bubbles, pending "Sending" reconciliation, the group read-only notice, the 4000-character limit. |
| WhatsApp settings (channel, transport, test) | `whatsapp-settings` (new — registered; wasn't in the router before) | Same `SectionCard` conversion as Ops Settings: green channel card (Linked badge in its trailing slot), blue transport card (status badge trailing), purple test card. QR code now sits on its own card surface instead of floating on the page background. | Link/Unlink with confirm, the QR/pairing-code panel and its 2.5s poll, the send-a-test form. |
| WhatsApp thread (debug) | `whatsapp-thread` (new; `DebugAsync` loads the real first chat) | Registered so the thread can be screenshotted directly. | — |

## Deliberately kept as-is

- The WhatsApp composer and message bubbles stay hand-built (there is no kit
  "chat composer" component); they already use `DirText`, RTL-aware
  direction detection and kit colour tokens, so restyling them further risked
  regressing a working, carefully-ordered piece (pending-message
  reconciliation) for no visual gain.
- `WipeLogCard` stays a plain `NeonCard(.tinted(.neonDangerStrong))` rather
  than `SectionCard`, because `SectionCard` always draws the `.glass`
  surface — a danger-tinted card is a different, deliberate pattern the kit
  itself uses for destructive blocks. Added an `IconTile("trash", hue: .red)`
  next to its heading for visual weight.

## New strings

Two new keys in `ar.lproj/Ops.strings` (everything else reused existing
translated copy, since `L()` searches every table): `"Attendance device"`,
`"Sync with the device"`.

## Build

Clean: `xcodegen generate -q && xcodebuild … build` → `BUILD SUCCEEDED`, no
warnings introduced. No server code touched, so no `tsc`/`lint`/`npm test`
run was needed.

## Open issues (round 1)

- None blocking. If the reviewer wants the WhatsApp composer restyled to the
  kit's `NeonTextField`/`FormField` chrome, that's a contained follow-up —
  flagged here rather than attempted this pass, per the note above.

---

## Round 2 — the design critic's 20 findings

Merged `ux-base3` first (fast-forward, already current). All twenty issues
were addressable inside this area's own files; none skipped.

| # | Screen | What changed |
|---|---|---|
| 1 | `whatsapp-thread` | Group senders no longer print the raw LID (`"117832578793490"`). `whatsAppGroupAuthorLabel` gives `L("Group member")` — the server has no pushname/contact-name field on `whatsapp/messages` today, and resolving one is a worker change outside this area's files, so every member reads as one honest anonymous label rather than a digit string. It is drawn in `.neonCaption` semibold, coloured by `NeonPalette.color(for: message.author)` (a stable colour per author id, the same source `ChatMessageRow` uses), and only on the first bubble of a run (`showsAuthor`), matching the studio's own group rooms. |
| 2 | `whatsapp` | `WhatsAppChatRow` now picks a person-glyph `.icon` leading mark, tinted by the number, whenever `chat.displayName` has no letters in it (`whatsAppNameLooksLikePhoneNumber`) — a phone-number "name" no longer feeds `AvatarView.initials` "+" and "7". Groups are unaffected. (The kit-wide fix the critic suggested, teaching `AvatarView.initials` itself to return a glyph for any name without letters, lives in `ios/Sources/UI/`, which this area does not edit.) |
| 3 | `ops-settings@automation` | The switch is now `ToggleRow(L("Let rules speak"), …)`, wording the *action* rather than asserting a state that could contradict the toggle; the detail line itself says which way it's set ("each rule still needs its own switch" / "no rule says anything…"). Its tile changed from purple `bolt.badge.a` to cyan `bolt.fill` — the same hue as the card header. |
| 4 | `whatsapp-settings`, `ops-settings@automation` | Both the Sending card and the Company channel card now show one plain fact per row — `Sends from` (formatted like the inbox, `formattedWhatsAppNumber`) and `Status` (`Sending normally` / `Not reaching WhatsApp`) — with the worker URL, transport name and internal line id (`main`) moved into a collapsed `DisclosureGroup(L("Technical details"))`. The trailing badge is now the connection status ("Connected"/"Unreachable"), not the transport's name. |
| 5 | `ops-attendance` | The month section now leads the page; the device read follows, and while it loads it costs one `SkeletonCard(lines: 2)` + `MetaLabel(L("Asking the device…"))` rather than five `ListCardRow`-shaped skeletons across the whole screen. `DeviceStatusCard` and the sync button (`AttendanceConsoleCard`) stay on the root; Enrolled, Pair people and Wipe the log moved to a pushed `AttendanceDeviceRoute` page, reached by its own `ListRow(L("The device"), subtitle: "ip:port · N enrolled")`, so the destructive Wipe card is no longer part of the everyday scroll. |
| 6 | `ops-requests` | "Waiting for you" now leads the page; the four "hasn't written yet" cards became one `SectionCard(L("Today's reports"), …)` (`TodaysReportsCard`) that lists written reports as `ListRow`s and ends with an `AvatarStack` + one line, `L("%d haven't written today's report yet")` — silence is still never called a verdict, just counted, in roughly a quarter of the space. |
| 7 | `ops-requests@pending` | The note clamps to 4 lines (`DirText(..., lineLimit: 4)`) with a "Show more" `ViewAllButton` that expands it. The meta line is now `name · relative date` (`relativeDayTime`), dropping the role and the year. The title sits in a leading-aligned stack next to the tile (`fill: false`), matching the Decided rows. A `SectionLabel(L("To buy"))` shows quantity/cost as `KeyValueRow`s, or `L("No quantity or cost given")` when neither is set — so a mis-filed daily report is obvious before Approve/Decline. |
| 8 | `ops-requests@decided` | Decided rows get a leading `.icon("shippingbox.fill", tint: supplyStatusIconTint(status))`, matching the pending card's tile. An `APPROVED` row gets a visible trailing `NeonButton(L("Mark bought"), …)` in `ListRow`'s trailing slot, in place of a long-press-only `contextMenu`. |
| 9 | `ops-attendance@month` | Each figure is now labelled — `L("Late %@", …)` in `.neonWarningStrong`, shown only when `> 0` (else no trailing value) — instead of a bare, unlabelled "11h". `"%d days recorded"` gained a real singular (`daysRecordedLabel`, `"%d day recorded"`). The leading mark is now a real `AvatarView` (initials) instead of a person glyph that read as a warning icon in orange. The person page's `StatTile` uses the same `describeMinutes` formatting as the list, replacing its own `.decimal(2)`. |
| 10 | `ops-attendance@month` | The header is `SectionHeader(L("Recorded"))` with a trailing month control (`monthControl`): two `IconButton`s at a 44×44 `contentShape`, no longer bare 12pt chevrons, either side of the month label — so it no longer wraps to two lines nor keeps saying "this month" once you've paged away. The footnote is reworded for a phone with no grid: `L("A person with no days here had nothing recorded — not that they were absent.")`. |
| 11 | `ops-attendance-person` | Row titles are now the weekday and day with no year (`formattedWeekdayDay`, e.g. "Thu 17"), since the page is already scoped to one month. Status moved into a `BadgeView` (`attendanceBadge`) instead of bold trailing text, so dates no longer wrap to two lines. The subtitle is the note, and the leading tile is tinted by the same status hue (`leadingTint`). "no clock-out" moved into the row's `meta` slot in a muted tone rather than repeating as bold status text on every day. |
| 12 | `ops-attendance-person` | `MANUAL` rows at zero delay now read `L("Set by hand · no lateness")` in a `.neutral` badge (`attendanceBadge`), rather than borrowing the device's own "On time" for a day the manager typed by hand. The "Days recorded" `StatTile` gets a caption, `L("%d set by hand", …)`, when any of the month's rows are hand-set. |
| 13 | `ops-attendance-person` | The nav bar's lone glass "+" disc became a plain `Button { … } label: { Label(L("Correct a day"), systemImage: "square.and.pencil") }`. The same action is also offered at the end of the day list as a labelled button, and as the `EmptyState`'s own action when nothing is recorded yet — discoverable, not only a glyph in the bar. |
| 14 | `ops-settings@push` | The two card-on-card `KPICard`s became `KeyValueRow`s: `Server keys` with a `.success`/`.neutral` `BadgeView` for its value, and `Devices that can be reached` as a plain count — no more "Set" drawn at KPI weight. The AltStore/signing note is gone; the card now says plainly that native push isn't wired up yet, true on every build (TestFlight included) rather than naming one signing method. Team-device rows now show a real `AvatarView` and `L("%d devices", n)` instead of an unlabelled "1", with `NeonDivider`s between them. |
| 15 | `ops-settings@workingday` | Weekdays are one row of seven `Chip`s using `Calendar.shortWeekdaySymbols`/`veryShortWeekdaySymbols` in Arabic, not full names. The six time/number fields are paired two-up (`Starts`\|`Ends`, `Lunch at`\|`Lunch`, `Left unplanned`\|`Grace before late`). A new `OpsTimeField` draws the kit's own field chrome with a plain time label instead of the system's grey compact `DatePicker` sitting inside it, opening a wheel picker in a sheet on tap. "Margin" and "Allowed late" are renamed `Left unplanned` / `Grace before late`, each with a `hint`. |
| 16 | `ops-settings@automation` | Subtitle shortened to `L("Rules only speak — they never move work.")`. The empty state is now `EmptyState(symbol: "bolt.fill", title: L("No rules yet"), detail: …, actionTitle: L("Add a rule"), …, hue: .cyan)` instead of a bare grey tile with no explanation or button. "Preview against today" is hidden while `rules.isEmpty`. All three secondary Save buttons on this page (working day, planning notes, timezone) now track `isDirty` against the loaded value: disabled and `.secondary` when clean, `.primary` and enabled once something has actually changed. |
| 17 | `whatsapp` | The `"You: %@"` prefix wraps its Arabic/English body in Unicode directional isolates (`\u{2068}…\u{2069}`) before formatting, so the label's colon and the message no longer swap sides under RTL. `whatsAppTimeLabel` now returns the clock for today, `L("Yesterday")` for yesterday, the weekday within the last 7 days, and a month/day with no year within the current year — matching `ListCardRow`'s own times in Chat, instead of a full dated string every row. |
| 18 | `whatsapp-thread` | Bubbles now use the kit's own type (`.neonBody`, `.neonCaption`, `.neonMeta`, …) instead of `.system(size:)`, and the page background is `.neonAmbientBackground()` instead of a hand-painted `Color.neonBg`. Every bubble's date became a single clock time; a centred `WhatsAppDayPill` (`L("Today")`/`L("Yesterday")`/a full date) now separates runs of messages from different days. A document attachment's title is its own filename (`WhatsAppAttachmentRow.title`), with `"Document · Tap to open"` moved to the subtitle. Plain links are linkified (`NSDataDetector` → `AttributedString`, `.tint(.neonAccent)`). The three-line jargon footer became one `StatusNote(symbol: "lock.fill", tone: .info, title: L("Groups are read-only here — reply from the phone."))`. |
| 19 | `whatsapp-settings` | `Unlink` is now `NeonButton(symbol: "iphone.slash", kind: .tinted(.neonDangerStrong), …)` — a real, existing SF Symbol, in place of `link.badge.minus` (which draws nothing) on a plain secondary pill. The linked number goes through `formattedWhatsAppNumber`, matching the inbox. The test card's glyph changed to `checkmark.message.fill` so it no longer shares `paperplane.fill` with the Sending card above it in a different hue. The test message field is now a two-to-four-line `NeonTextEditor` instead of a single-line field. |
| 20 | `ops-sitevisits` | The empty state now explains why the page is empty — `L("Only people with \"Logs site visits\" ticked on their page can plan one.")` — with `actionTitle: L("Choose who logs visits")` pushing to the Team area's employee list (`EmployeesRootView`, referenced not edited). `VisitReadRow` shows `BadgeView(text: L("Not written up yet"), tone: .orange)` instead of the raw `PLANNED` state label whenever `siteVisitAwaitingReport(visit)` is true, so the badge no longer disagrees with the group heading it sits under. |

### What I could not check, and did nothing about as a result

Per the critic's own list: no `.ar` shots exist for any ops screen (so RTL
here is unverified by screenshot — the usual rules were still followed:
`DirText`, leading/trailing, no bare left/right); the site-visits shots are
all the same empty state (owed/upcoming/done groups unseen with data); the
`ops-settings@integrations` scroll anchor never moved (Timezone and Other
integrations unreviewed); and the attendance device cards never loaded live
(advice on them was from the code). Nothing was changed in those areas
beyond what's listed above, since there was no observed problem to fix.

### New strings (round 2)

All new keys are in `ar.lproj/Ops.strings` / `ar.lproj/WhatsApp.strings`
(see the "Round 2" sections at the end of each file). A handful of strings
used on these screens (`"Late"`, `"Today"`, `"Yesterday"`, `"Recorded"`,
`"Previous month"`, `"Next month"`, `"Quantity"`, `"%d people"`) are not
defined here at all — they already exist, translated, in another area's
table (`Home`, `Chat`, `Team`, `Tasks`, `Localizable`, …), and `L()` finds
them there, since it searches every table.

### Build

Clean: `xcodegen generate -q && xcodebuild … build` → `BUILD SUCCEEDED`.
No server code touched (no ops/WhatsApp issue here needed server data), so
no `tsc`/`lint`/`npm test` run was needed.
