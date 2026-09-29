# Home — redesign progress

The manager's Home tab, rebuilt on the kit (`ios/Sources/UI`) to match the
owner's `home-mockup.jpg`, in its order: header → hero → four figures →
Project Progress → Today's Tasks → This Month → Reviews | Needs you → Quick
Actions, then the team (Right now, The day) and every project.

## Screens and sheets (debug router ids)

| Screen | Id | Anchors (`-neonScroll`) |
|---|---|---|
| Home tab (`AdminHomeView`) | `tab-home` | `kpis`, `progress`, `today`, `month`, `reviews`, `actions`, `now`, `day`, `projects` |
| Everything on today's calendar (`HomeTodayView`, "View All" on Today's Tasks) | `home-today` | — |
| Search over projects, people and conversations (`HomeSearchView`, header magnifier) | `home-search` | — |
| Upload Photos: project → room → the projects area's `AddPhotosSheet` (`HomeUploadPhotosSheet`) | `home-upload-photos` | — |

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
  15-minute cache, hidden when the request fails), the cover of the most
  recently updated project that has one as the photo, and the arrow → Projects tab.
- **Four figures** — `KPICard`s, four to a row, counting up:
  - Total Projects: trend "+N this month" (projects created this month) and
    bars = projects that existed at the end of each of the last six months.
  - Published: **no trend or bars** — nothing records when a project was
    published. Caption "of N projects".
  - Pending Approvals: trend vs a week ago, bars = approvals waiting at the end
    of each of the last six weeks (open from `createdAt` to the client's
    `respondedAt`).
  - Updated This Week: **no trend or bars** — `updatedAt` keeps only the last
    edit. Caption "in the last 7 days" (exactly how the server counts it).
  - Each ⋮ menu: Open projects (and New Project on the first).
- **Project Progress** — `SegmentedProgressBar` + an area legend that wraps
  (up to nine statuses), from the real `pipelineStatus` of every project, named
  as the website names them (`PIPELINE_STATUSES`; Arabic from `pipeline.*`).
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
- **Reviews** — count of TaskSubmissions waiting + the submitters' avatars
  (`home/pulse` → `reviews`, falls back to the overview badge) → Reviews.
- **Needs you** — unread alerts → Alerts, open supply requests → Requests (the
  old "Needs you" strip's other two counts).
- **Quick Actions** — one sideways row: New Project, Hand out a Task, Set a
  Meeting (team channel, the chat's own sheets), Upload Photos, Open the board
  (Tasks tab), Employees, Payroll, More (tab).
- **Right now** — `home/now`, restyled as rows in one card; refreshes every
  60 s; "Nothing planned right now" / "The day hasn't started yet" / "Outside
  working hours", never idleness. Tap → the employee's page.
- **The day** — `home/day`: ringed avatars, the six counts (Unanswered is never
  coloured as a fault), the pressing people with blocked / said-started /
  waiting-on-you notes, and the footnote that silence is not a verdict.
- **Projects** — every project as a cover card in a sideways row (publish
  badge, completion ring, client · place, pipeline status, approvals, comments,
  last update) — what the old "Recent projects" + "All Projects" held. "View
  All" → Projects tab.

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
  actions as before. Right now's 60 s refresh. The day board's full content and
  its footnote. Every project still reachable from Home.
- Tabs that own a `NavigationStack` (Projects, Tasks, More) are opened by
  switching tab (`HomeTabLink`, through `PushCenter.pendingPath`, as a tapped
  notification does), never pushed inside Home's stack.

## Open issues

- Switching tabs goes through `PushCenter.pendingPath`, the notification route;
  a proper "open tab" API on the shell would be cleaner (not my file).
- `SearchField` cannot be focused programmatically, so search opens without the
  keyboard up.
- A job opens the whole Tasks tab rather than the job, and a board cell opens
  its project rather than the cell: no native single-cell/single-job screen
  takes an id.
- The hero's `photo: .none` (no project has a cover) shows a hard vertical
  band on the trailing side (kit).
