# Home — redesign progress

The manager's Home tab, rebuilt on the kit (`ios/Sources/UI`) to match the
owner's `home-mockup.jpg`, in its order: header → hero → four figures →
Project Progress → every project → Today's Tasks → This Month → Proof to
check | Needs you → Quick Actions → the team (one card: who is on what, and
how their day is going).

## Screens and sheets (debug router ids)

| Screen | Id | Anchors (`-neonScroll`) |
|---|---|---|
| Home tab (`AdminHomeView`) | `tab-home` | `kpis`, `progress`, `projects`, `today`, `month`, `reviews`, `actions`, `now`, `day` (`now` is the top of the team card, `day` its lower half) |
| Everything on today's calendar (`HomeTodayView`, "View All" on Today's Tasks) | `home-today` | — |
| Search over projects, people and conversations (`HomeSearchView`, header magnifier) | `home-search` | — |
| Upload Photos: project → room → the projects area's `AddPhotosSheet` (`HomeUploadPhotosSheet`) | `home-upload-photos` | — |
| The published projects (`HomeProjectListView`, tapping the Published figure) | `home-projects-published` | — |
| The projects updated in the last 7 days (`HomeProjectListView`, tapping Updated This Week) | `home-projects-updated` | — |

Reused, not mine (their own areas register them): `NewProjectSheet` (Projects),
`ChatTaskComposeSheet` / `ChatMeetingComposeSheet` / `MeetingsView` /
`ChatRoomView` (Chat), `AddPhotosSheet` / `ProjectDetailView` (Projects),
`EmployeesRootView` / `EmployeeDetailView` / `PayrollRootView` (Team),
`RequestsRootView` (Ops), `AlertsRootView` / `ReviewsRootView` /
`AnalyticsRootView` (Home insights).

## What each block is, and where its numbers come from

- **Header** — `ScreenHeader.brand`: search (pushes `HomeSearchView`), the bell
  with a red dot when `home/overview` badges.alerts > 0 (pushes Alerts), and
  the "N" avatar, which switches to the More tab.
- **Hero** — `HeroCard`: greeting by the phone's clock ("Good evening,"), the
  manager's first name from the Employee row with `accessRole MANAGER`
  (`home/pulse` → `manager`; no row → no name, the greeting becomes the title),
  today's date, weather for Amman from Open-Meteo (`HomeWeather.swift`, no key,
  15-minute cache, hidden when the request fails) on a small frosted tile so
  the white figure reads over the photo, the cover of the most recently
  updated **published** project that has one (else any project's cover, else
  the kit's own illustration) as the photo, and the arrow → Projects tab.
- **Four figures** — `KPICard`s, four to a row, counting up. Each card is
  itself the button (`.pressableCard`) and opens what it counts; there is no
  ⋮ menu (four menus offering the same one action said nothing):
  - Total Projects → Projects tab. Trend "+N this month" (projects created
    this month) and bars = projects that existed at the end of each of the
    last six months.
  - Published → `HomeProjectListView(.published)`. **No trend or bars** —
    nothing records when a project was published. Caption "of N", one line.
  - Pending Approvals → Projects tab (approvals live on each project's own
    Approvals tab; there is no list of them across projects). Trend vs a week
    ago, bars = approvals waiting at the end of each of the last six weeks
    (open from `createdAt` to the client's `respondedAt`).
  - Updated This Week → `HomeProjectListView(.updated)`. No caption; bars
    computed on the phone from `overview.projects` (`homeUpdatedBars`): how
    many projects were last edited in each of the last seven 24-hour windows,
    the same rolling week the server counts, so the bars add up to the
    figure. `updatedAt` keeps only a project's latest edit, so that is all
    the bars claim — no new read.
- **Project Progress** — `SegmentedProgressBar` + the legend, from the real
  `pipelineStatus` of every project. Legend labels are short enough for one
  line each (`pipeline.short.*`: "In review" for CLIENT_REVIEWING, "Internal",
  "Sent", "Changes"; the rest as the website names them, Arabic from
  `pipeline.*`). Up to four statuses spread from the leading edge to the
  trailing one; more wrap into a grid of three (up to nine). "View All" →
  Projects tab.
- **Projects** — right under Project Progress (where its "View All" points):
  every project as a cover card in a sideways row (publish badge, completion
  ring, client · place, pipeline status, approvals, comments, last update).
  "View All" → Projects tab.
- **Today's Tasks** — `home/today`: board cells scheduled for today or due at a
  moment today, jobs whose span includes today (active people), meetings that
  start today; sorted by time. Project cover (or a tile), title, project ·
  person / person · until <day> / place · N invited, the time in the studio's
  timezone, the board state in words under it (In progress, Sent for review),
  and a **display-only** `CheckCircle` (green = DONE, i.e. approved). Tapping:
  a cell → its project; a meeting → Meetings; a job → the Tasks tab (week
  board; there is no single-job screen). First four on Home, "N more today" and
  "View All" → `HomeTodayView`. Empty: "Nothing planned for today".
- **This Month** — `home/pulse` → `month`, one metric at a time from a
  `PillMenu` (remembered per phone): **Work done** (board steps and jobs marked
  done, by `completedAt`), **Projects sold** (by Sold on), **New projects** (by
  created day). Weeks of the month from the 1st (W1 = 1–7 … W5 = 29–31), this
  month's bars against last month's paler ones, a legend naming both months,
  and the change against **the same days of last month** (never a running month
  against a whole one). No money anywhere.
- **Proof to check** (was "Reviews", with a star that read as client
  ratings) — `checkmark.seal.fill`, orange (approvals are orange): count of
  TaskSubmissions waiting, "Awaiting your approval", and either the
  submitters' avatars or, at zero, a green tick "All checked" (`home/pulse` →
  `reviews`, falls back to the overview badge) → Reviews.
- **Needs you** — `tray.full.fill`, indigo (no longer repeating the alerts
  row's bell): unread alerts → Alerts, open supply requests → Requests. The
  label agrees with its figure ("1 Open request", "3 Open requests"). Both
  half cards use the same figure font (`.neonTitle`).
- **Quick Actions** — the kit's grid form, four to a row, every action in
  view: New Project, Hand out a Task, Set a Meeting (team channel, the chat's
  own sheets), Upload Photos / Open the board (Tasks tab), Employees, Payroll,
  More (tab).
- **The team** (`HomeTeamCard`, titled "Right now", "What each person is
  on") — what used to be two cards listing the same people twice. One row of
  ringed avatars (`home/day` everyone, in the board's order; more than four
  scroll sideways). Under each name, at most two lines of what they are on
  (`home/now`): the plan's current block with its pulsing dot ("until
  13:00"), else their most recently started IN_PROGRESS item (sorted newest
  first) with "for 3h 12m" — or, past a day, "since Thu 10 Sep" in the
  studio's timezone, because a count of hours since a start read as somebody
  working non-stop for 20 days. The rest is one "+N more" capsule (the Today
  card's capsule look). Nothing on → "Nothing planned right now" / "The day
  hasn't started yet" / "Outside working hours", never idleness. Tapping a
  person → their page. Refreshes every 60 s.
  - The ring is the day's judgement in the plain tokens (`.neonDanger`,
    `.neonWarning`, `.neonSuccess`; text in the Strong ones). "No plan" before
    the working day starts (`beforeWork` from `home/now`) is the manager's
    to-do, not the person's fault, so it stays grey then. When everybody's
    judgement is the same, it is said once under the row ("No plan published
    for today yet") instead of under every face.
  - Under the row: the day board's counts that aren't zero, as the kit's
    `BadgeView`s in a `FlowRow`, one tone per count whatever its value
    (on the day green, no plan amber, blocked red, said started orange,
    overloaded amber, unanswered grey — never coloured as a fault); the
    people with blocked / said-started / waiting-on-you / overloaded notes;
    and the footnote that silence is not a verdict — only when a question is
    actually unanswered.

Everything arrives with the kit's motion: cards `neonAppear`, rows `staggered`,
figures count up (`KPICard`, `HomeCountUp`), bars and the segmented bar grow.

## Server (additive)

- `home/pulse` (`src/lib/mobile/home-pulse.ts`, pure half
  `home-pulse-rules.ts`, tests `tests/home-pulse.test.ts`) and `home/today`
  (`src/lib/mobile/home-today.ts`), both `guarded(requireAdmin, …)` in
  `registry/home.ts`. Existing reads are unchanged.
- **Until the server is deployed, the live app gets an error from these two
  reads**: Today's Tasks and This Month then show "Couldn't load this" with
  Retry, the KPI cards show no trends/bars, and the greeting has no name.

## Kept deliberately

- New project, hand out a task, set a meeting, open the board: same sheets and
  actions as before. Right now's 60 s refresh. The day board's counts, notes
  and footnote (now shown when it applies). Every project still reachable
  from Home.
- Tabs that own a `NavigationStack` (Projects, Tasks, More) are opened by
  switching tab (`HomeTabLink`, through `PushCenter.pendingPath`, as a tapped
  notification does), never pushed inside Home's stack.

## Open issues

- Switching tabs goes through `PushCenter.pendingPath`, the notification route;
  a proper "open tab" API on the shell would be cleaner (not my file).
- `SearchField` cannot be focused programmatically, so `HomeSearchView` draws
  `HomeSearchBox`, the kit field's look with a focus binding, to open with the
  keyboard up. Go back to `SearchField` once the kit takes a focus binding.
- The Dynamic Island fade (`HomeStatusBarFade`) is Home's own overlay; every
  other tab page still lets cards run under the clock. It belongs in
  `NeonScroll` (kit).
- `describeMinutes` (Core) has no days branch, and the Team area's
  `EmployeeDetailView` keeps its own copy with the same "484h" problem.
- A job opens the whole Tasks tab rather than the job, and a board cell opens
  its project rather than the cell: no native single-cell/single-job screen
  takes an id.
- The hero's `photo: .none` (no project has a cover) shows a hard vertical
  band on the trailing side (kit).

## Round 2 — the critic's review of the live screenshots

Changed:

- **Right now + The day merged** into one team card (issues 2, 3, 13, 14):
  one list of people, at most two lines each, "+N more" for the rest, sorted
  newest first; "since Thu 10 Sep" past a day (issue 1); rings in the plain
  tokens and grey before the working day; one shared line instead of four
  identical captions; the footnote only when something is unanswered; the
  six counts as non-zero `BadgeView` chips, one tone each (issue 4). Arabic
  titles are centred in their column, in their own direction, so a long one
  no longer drifts away from its meta line. The page is about three screens
  shorter.
- **Projects** moved up under Project Progress (issue 13).
- **KPI row** (issues 5, 6): cards are buttons that open what they count, no
  ⋮; Published says "of N" on one line; Updated This Week has no caption and
  honest bars from `overview.projects`. New screen `HomeProjectListView`
  (`home-projects-published`, `home-projects-updated`).
- **Proof to check** / **Needs you** (issues 7, 8): renamed, re-iconed,
  "All checked" at zero, labels agree with the count, same figure font.
- **Quick Actions** as a 4-column grid, all eight visible (issue 9).
- **Hero** (issue 10): weather on a frosted tile; a published project's cover
  first; the kit's illustration when nobody has a cover.
- **Status bar** (issue 11): `HomeStatusBarFade`, the page's own ambient,
  solid over the status bar and fading just below it, on the Home tab.
- **Legend** (issue 15): short one-line labels ("In review" / "قيد المراجعة"),
  spread to the trailing edge.
- **Search** (issue 16): opens with the keyboard up; before typing, the four
  latest projects and the team as rows.
- **Upload Photos** (issues 17, 18): publish badge on every project; for a
  published one, "The client sees these straight away" above the rooms; every
  row the same thumbnail slot.
- **home-today** (issue 19): the debug route loads through the screen's own
  states, so a failed read shows the app's ErrorState with Retry.

Not done here (not this area's files):

- Issue 1, second half: the days branch in `describeMinutes`
  (Core/Formatting.swift) and the copy in Team/EmployeeDetailView.swift.
- Issue 8, the `.stringsdict`: `L()` (Core/Localization.swift) returns the
  English key untouched and only reads `ar.lproj` tables, so a plural rule
  would never reach English. The labels are picked by count instead.
- Issue 10, the hero photo's mask stops (kit, `HeroCard`).
- Issue 11 for every other tab (kit, `NeonScroll`).
- Issue 12, the tab bar (NeonAdminApp.swift, the shell).
- Issue 18, a folder tile as the thumbnail placeholder (kit, `RemoteImage`),
  and the Skills / Bond cafe covers (`resolvedMediaURL` is Core; their URLs
  are on the live server, which this pass cannot read).
