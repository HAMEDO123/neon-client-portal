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

## Round 2 — the critic's review

Merged `ux-base3` (fast-forward, already up to date) and went through all 19
numbered issues. Sixteen were fixable inside this area's files; three needed a
file outside its scope (`ios/Sources/Features/Me/`, `App/MoreView.swift`,
`ios/Resources/ar.lproj/{Me,App}.strings`) and are skipped below with why.

### Fixed

1. **Crash on launch (`me-today`, `me-today@tomorrow`, `more-employee`).**
   `MeScreens.view` now injects `StaffStore()` at every site that needs it —
   `TodayView`, `EmployeeMoreView`, the `me-notifications` debug entry — so
   opening any of them no longer hits SwiftUI's missing-`@EnvironmentObject`
   fatal error.
2. **Raw Swift enum on a blank page (`me-job-detail`), sign-in wiped by a
   wrong-side 401 (`me-tasks`, `me-task-detail`, `me-notifications`,
   `me-proof`).** The *display* half is fixed: `MeScreens.swift` gained a
   local `MeDebugAsync`, a stand-in for the shared `App/DebugScreens.swift`
   `DebugAsync` whose failure branch is `Text(verbatim: "\(error)")`. This
   area's own async debug entries (task detail, job detail, proof) now go
   through `MeDebugAsync` instead, which reports a failure as `ErrorState` on
   a `NeonScroll` like every other screen. **The other half — the server
   answering a valid token on the wrong side's route with 401 instead of 403,
   and `APIClient.send` treating every 401 as a dead session — is not fixed.**
   Both fixes live outside this area (an `/api/mobile/*` route under `src/app`,
   and `Core/APIClient.swift`), and the brief's own file list gives this area
   no server-registry exception the way home/projects/chatlist have. See
   "Skipped" below.
3. **`ProofSheet` not RTL, hand-rolled chrome (`me-proof`).** Rebuilt on
   `SheetScaffold(...) { … } content: { … }` ending in `.neonSheet([.large])`;
   the note is `NeonTextEditor`, the error is `ValidationMessage`, the footer
   is `.neonFootnote`/`.neonTextTertiary`, and the camera's `fullScreenCover`
   carries `.neonLanguage()`. Fixed once, in the sheet itself, so all four
   presentation sites (`TasksView` ×2, `AssignedJobs`, `MyChatJobs`'s send-proof
   callers) inherit it with no call-site change needed.
4. **Ragged two-column Arabic cards (`me-assign`).** `AssignRootView`'s job
   row and `JobRow` both draw the title with `DirText(job.title, font:
   .neonRowTitle, fill: false)`, so the block hugs the leading edge in either
   language instead of the title alone flipping to the trailing edge. People
   are `AvatarView(style: .solid)`, as chat's list already does.
5. **Uppercase/wrong-vocabulary chips, two chips as a default (`me-assign`,
   `me-task-detail`, `me-job-detail`).** `Core/Formatting.swift`'s
   `taskStateLabel`/`StateBadge(state:)` are shared by every area (Tasks,
   Chat, Home, Ops, Calls, this one) and are not this area's file to rewrite —
   so instead this area added its own `MeShared.swift`: `meTaskStateLabel`
   (TODO → "To do", DONE → "Approved", everything else unchanged) and
   `meStateBadge`, the kit's `StateBadge` shape with that wording. Every row
   and detail header in this area now calls `meStateBadge` instead of the raw
   `BadgeView(text: taskStateLabel(...))`. `priorityChip` shows a badge only
   for `HIGH`, so a card never carries two status chips by default. The
   put-back button reads "Not started yet".
6. **No dates, no "no finish line" warning, no count (`me-assign`).**
   `AssignRootView`'s and `JobRow`'s rows now carry `MetaLabel(jobDateRange(...),
   symbol: "calendar")`, and `jobHasNoAcceptance` adds a
   `BadgeView(text: L("No finish line written"), tone: .warning, …)`. A
   `SectionHeader(L("This week"), count: week.tasks.count)` sits above the list.
7. **Week switcher under the kit (`me-assign`).** Both chevrons are now
   `IconButton(size: NeonSize.circleButton)` (44 pt), the week label is
   `.neonCardTitle`, "This week" is a `ViewAllButton(chevron: false)`, and the
   page is built on `NeonScroll(spacing: NeonSpace.stack)` instead of a bare
   `ScrollView`.
8. **Approved/submitted work editable and deletable from a phone, five names
   for one idea (`me-assign`).** A `SUBMITTED` or `DONE` job now pushes
   `JobDetailView(jobId:)` read-only; the edit sheet (with Delete) is offered
   only for `TODO`/`IN_PROGRESS`. One word throughout: nav title "Hand out
   work", FAB "Hand out a job", sheet "New job"/"Edit job", delete "Delete
   this job".
9. **Hue/glyph collisions across 11 tiles (`tab-more`, `more-admin`).** Each
   idea now has one hue: Reviews orange (`tray.and.arrow.down.fill`), Alerts
   red, Requests amber, Analytics blue, Attendance indigo, Payroll and
   WhatsApp both green but in different cards (Work vs. Team), never
   neighbouring.
10. **Team card's empty sixth slot, home-grown tile metrics (`tab-more`,
    `more-admin`).** Regrouped to fill every row: Work = Reviews, Requests,
    Alerts, Meetings, Site visits, WhatsApp (6); Team = Employees, Payroll,
    Attendance (3, a full row); Analytics and Settings moved into the account
    card as `ListRow`s. The grid uses `NeonSpace.md` (12 pt) between tiles and
    `NeonSize.iconTileLarge`/`.neonLabel` so it no longer drifts from Home's
    Quick Actions.
12. **Duplicated "Signed in as", plain-`Label` account rows (`tab-more`,
    `more-admin`).** Dropped the header subtitle; the account card is built
    from `ListRow`s (language toggle, Sign Out) with a `NeonDivider` between,
    keeping only the one "Signed in as" line at the foot.
13. **Empty "You" card, holes in "Given to you" (`more-employee`).** Removed
    the "You" card; Profile is now the account card's first `ListRow` (name,
    "Profile, notifications, devices" subtitle, avatar). "Given to you" only
    renders as a 3-tile grid when all three permissions are granted; 1–2 render
    as `ListRow`s appended to the account card instead of a grid with holes.
14. **"Mark all read" crowding the back button, no Close on the sheet, a
    silently-swallowed chat notification, slow-feeling navigation
    (`me-notifications`).** Moved to `.topBarTrailing`. `TodayView`'s sheet
    presentation now has a leading `IconButton("xmark", label: L("Close"))`
    and passes `openChat: { showAlerts = false; tab = .chat }` through (via
    `EmployeeMoreView`'s own `openChat` too). Opening a row navigates first;
    marking read, reloading and refreshing the store's badge all happen in a
    detached `Task` afterwards.
15. **Ungrammatical empty-day copy (`me-today`).** Changed to
    `EmptyState(title: L("Nothing planned for today"), …)`, matching
    `lib/now-next.ts`'s own English word for word. (The web has no Arabic
    string for this particular sentence to match against — the employee
    portal's own i18n table has no entry for it — so the Arabic here is a
    plain new translation, not a copy of an existing one.)
16. **"From the manager" asserted for every job (`me-job-detail`,
    `me-tasks`).** Until the server carries an assigner, every site says
    L("Handed to you") / L("Handed out directly") instead of naming "the
    manager" — `TasksView`'s section, `JobRow`'s caption, `JobDetailView`'s
    header badge and `ProofSheet`'s subtitle when opened from a job.
17. **Un-retryable "Couldn't load this", 20 pt trash hit area, fixed-size
    text, stale copy, a second Sign Out (`me-profile`).** A permanent
    `APIError.refused` now renders `EmptyState(symbol: "lock.fill", title:
    L("This page is for the team"), detail: message, hue: .grey, card: true)`
    with no Retry. The forget button is `IconButton("trash", label: L("Forget
    device"), look: .plain, size: NeonSize.touch)` (44 pt, spoken label).
    Fixed sizes replaced with `.neonCaption`/`.neonTextTertiary`/
    `.neonSubtitle`. Copy changed to L("When somebody hands you work"). There
    was already only one Sign Out (More's) — the comment in the file says so.
18. **Grey segmented tabs truncating, dead Retry, 12 pt Cancel, non-kit empty
    state (`me-requests`).** Tabs are `PillFilterBar`, hidden until the first
    load answers so the filters never look tappable over a permanent error;
    the third tab is labelled "Report". Cancel is
    `NeonButton(kind: .ghost, size: .small)`. Both empty states are
    `EmptyState(..., card: true)`.

### Skipped — outside this area's files

- **Issue 2, server half:** the 401-vs-403 status code is set by an
  `/api/mobile/*` route under `src/app`, and the sign-out-on-401 rule is
  `Core/APIClient.swift`. Neither is `ios/Sources/Features/Me/`, `MeScreens.swift`
  or `Me.strings`, and the brief's server-registry exception names only
  home/projects/chatlist. Fixing only the debug-screen symptom (done, #2
  above) does not fix the underlying risk: any future shared screen or stale
  notification link will still be able to sign a real user out by asking a
  wrong-side route. This is worth another area's or a shared-infra pass.
- **Issue 5, `Core/Formatting.swift`:** the brief's suggested fix edits
  `taskStateLabel`/`taskStateTone` directly, but that file is read by every
  area (Tasks, Chat, Home, Ops, Calls) and isn't in this area's file list.
  Reached the same visual outcome instead through a local wrapper,
  `MeShared.swift`'s `meTaskStateLabel`/`meStateBadge` (see #5 above) — every
  call site in this area's files now shows the right words without touching
  a file five other areas also write to.
- **Issue 11, tab bar and `AccountMenu` size:** the system `TabView` is built
  in `App/NeonAdminApp.swift` (the app shell, not this area's), and
  `AccountMenu`'s `AvatarView(size: 30)` is inside `ios/Sources/UI/
  Components.swift` — the kit, which the brief says never to edit. Both are
  out of reach from this area's files.
- **Issue 17, `ErrorState`'s contextual title:** the suggested
  `ErrorState(message:, …)` with a per-screen title needs a `title:`
  parameter the kit's `ErrorState` (`ios/Sources/UI/Components.swift`)
  doesn't have — adding one is a kit change, off limits. The un-retryable
  "Couldn't load this" for a *permanent* refusal is fixed (`EmptyState`, no
  Retry, #17 above); only the *generic*-error branch still reads "Couldn't
  load this" rather than "Couldn't load your profile".
- **Issue 19, login:** `App/LoginView.swift` was never in this area's first-pass
  file list and still isn't touched — same as round 1's note, this screen
  belongs to whichever area owns the app shell.

### Build

`xcodegen generate -q` then the Debug simulator build: **BUILD SUCCEEDED**,
no new warnings from this area's files.
