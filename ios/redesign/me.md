# Area: me — progress

Branch `ux-me`, off `ux-base2`. Clean build (`xcodegen generate` + Debug
simulator build) succeeded after each change in this file.

## Screens and sheets covered

| Screen / sheet | Router id | What changed |
|---|---|---|
| Today (employee home tab) | `me-today` | Full rebuild on the kit: `ScreenHeader.brand` (no more nav bar — this is a tab root), a bell `IconButton` with `dot:` opens Alerts as a `.neonSheet` instead of living only in More, `HeroCard` for the greeting (eyebrow = time-of-day, title = name, ring = today's done/total), `NowNextCard` rebuilt on `IconTile`/`OnlineDot`/kit fonts instead of hand-rolled `Font.system`, Today's work and Tomorrow now each a `SectionCard` holding `TodayTaskRow`s with `NeonDivider`s instead of a bare `VStack`. `WarningsCard` kept (the kit has nothing for a pinned, non-dismissible multi-item warning strip with a dot tally) but retoned to kit colours. `.id("tomorrow")` + `ScrollViewReader` + `.debugScroll(proxy)` added for `-neonScroll tomorrow`. |
| Tasks (list) | `me-tasks` | `PillFilterBar` replaces the old segmented `Picker`; the board list and "From the manager" jobs are now each a `SectionCard` (icon tile, a live count subtitle) instead of a plain `SectionLabel` over a bare list. |
| Task detail | `me-task-detail` | Fonts moved to the kit's text styles (`.neonTitle2`, `.neonSubtitle`, `.neonFootnote`); "Send proof" is now `NeonButton(kind: .brand)`, start/put-back are `NeonButton(kind: .secondary)` — both get the kit's own spinner and disabled-while-running behaviour, so the screen's local `working` flag could be deleted entirely. Every `DetailCard`/`BulletList`/`StatusNote` section kept as-is (already kit). Follow-up card unchanged (already kit-built). |
| Job (handed out by hand) | `me-job-detail` | Same treatment as task detail: `NeonButton`s for the actions, header fonts to kit styles, `IconTile`s for the row form. |
| Assign (hand out work) | `me-assign` | Week header's chevrons are now `IconButton`s; the job row uses `FlowRow` for its badges and a proper `.neonSurface(.glass)` card; the empty state uses the kit's `EmptyState(card:)` with its action wired through the `action:` parameter (a trailing closure doesn't work once `hue:`/`card:` are also named). The hand-out/edit sheet was already fully kit (`SheetScaffold`, `FormSection`) and is untouched. |
| Requests (supplies / receipts / today's report) | `me-requests` | Segmented pill now carries a symbol per tab; supply and receipt rows moved off hand-rolled opacities onto `.neonTextSecondary`/`.neonTextTertiary`/`.neonCaption`; the receipt camera button is a `NeonButton(kind: .brand)`, the photo-library button an `IconTile(.glass)`. The rest (the money `NeonCard`, `ReportCard`, the sheet) was already kit and is unchanged. |
| Notifications / Alerts | `me-notifications` | Row icon is now a hued `IconTile` instead of a hand-tinted circle, unread dot moved onto the tile as a small badge, card surface via `.neonSurface(.glass)`, rows `.staggered()` in on load. Now also reachable from Today's bell icon as a sheet, not only from More. |
| Profile | `me-profile` | Identity card gained an `AvatarView(style: .solid)` and each line (email/phone/id/devices) is a small coloured `IconTile` instead of a plain grey glyph; device rows the same. Preferences card, `NumberField`, `NeonButton("Save preferences")` were already kit and are unchanged. |
| Proof sheet (send finished-work photo) | `me-proof` | Source buttons (Camera/Photos/File) are now hued `IconTile`s inside proper glass surfaces instead of flat white rounded rects; the picked-file row and empty placeholder moved onto `.neonSurface`/`NeonRadius`/`Color.neonLine`. "What proof to send" / "It will be checked against" stayed exactly where they were — above the camera, per the platform rule. |
| More — manager | `more-admin` | Full rebuild: the sidebar's rest is now a `ScreenHeader` + three `SectionCard`s ("Work", "Team", "Studio"), each a 3-across grid of coloured `MoreDestinationTile`s (a local, `NavigationLink`-pushing sibling of the kit's `QuickActionTile` — see kitRequests), plus an `AccountCard` (language toggle, sign out) instead of a plain `List`. |
| More — team | `more-employee` | Same shape: "Your day" (Alerts with its badge, Meetings, My requests), "Given to you" (Assign work / Site visits / WhatsApp, shown only for whoever the manager ticked for them — unchanged rule), "You" (Profile), `AccountCard`. |
| Login | *(app-level `login` id, not owned)* | Left mostly as found — it already used `BrandMark`, `NeonWordmark`, `neonAmbientBackground(animated: true)`, `SegmentedPill`, `NeonTextField`, `NeonButton`, `.shake()` and the kit's motion tokens throughout, so it already reads as the "branded, animated sign-in" the brief asks for. No changes made. |

## Kept deliberately

- Every existing action, route and refusal: no Done button anywhere proof
  goes through instead; nobody can mark their own work complete; an
  unanswered follow-up question is never phrased as "did nothing"; empty
  states say plainly what isn't known ("Nothing is scheduled on today",
  "Nothing on the board today.").
- Real data only — no new numbers were invented. The Today hero's ring and
  footnote count only `DONE` among the tasks `/today` already returned; the
  "%d on the board" subtitles just echo the array's own count.
- `AssignedJobs`, `MyChatJobs`, `MyRequests`, `Profile`'s server calls and
  request/response shapes: untouched. This was a visual rebuild, not a
  behaviour change.

## New strings

Almost everything already had a translation somewhere in the app (L()
searches every table), since most of what changed was visual. Nine strings
were genuinely new:
- `Me.strings`: `%d handed to you directly`, `%d of %d done so far today.`,
  `%d on the board for today`, `%d on the board`, `%d planned`,
  `%d task card(s)`, `Nothing on the board today.`
- `App.strings` (new table, for `MoreView.swift`/`LoginView.swift`):
  `Your day`, `%@, %d new`

## Open issues / kitRequests

- **No `NavigationLink`-pushing tile in the kit.** `QuickActionTile`/
  `QuickActionGrid` only take a tap `action: () -> Void`, so a destination
  grid (More, on both sides) needed a small local sibling,
  `MoreDestinationTile` in `App/MoreView.swift`, that looks identical but
  pushes a `NavigationLink` instead. Worth folding into the kit as a
  `QuickActionGrid`-shaped `NavigationLink` variant if another area needs the
  same shape.
- **Employee-side screens (Today, Tasks, task/job detail, Assign, Requests,
  Profile, Notifications) could not be screenshotted with live data** — the
  orchestrator only holds the manager's sign-in, and I was told not to try to
  get one of my own. They're registered in `MeScreens.swift` regardless (ids
  above) so they screenshot correctly once somebody signs in as a team member
  on the simulator; I designed them from the code, `FEATURES`-equivalent
  comments in the source, and the kit gallery rather than from a live shot.
  `more-admin` and `more-employee` need no employee session and should be
  screenshottable as the manager once that session exists.
- Nothing else outstanding; every file builds clean and every existing
  action is still reachable exactly where it was.
