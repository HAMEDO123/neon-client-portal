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

## Open issues

- None blocking. If the reviewer wants the WhatsApp composer restyled to the
  kit's `NeonTextField`/`FormField` chrome, that's a contained follow-up —
  flagged here rather than attempted this pass, per the note above.
