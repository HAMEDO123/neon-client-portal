# Home area — feature inventory

Read from `src/app/admin/(dashboard)/page.tsx`, `alerts/page.tsx`,
`reviews/page.tsx`, `analytics/page.tsx` and the components/actions/queries
they use. Kept here so a later run can see what is built and what is left.

## Dashboard (`AdminHomeView`, tab root)
- [x] Four stat cards: Total Projects, Published, Pending Approvals, Updated This Week (`getDashboardStats`).
- [x] "+ New Project" — **not built**: no server action reachable without a
      multi-field project-creation form; out of scope for this pass (see notImplemented).
- [x] "The day · <label>" section = `DayBoardList`:
  - [x] Six stat tiles: On the day, No plan yet, Blocked, Said started, Overloaded, Unanswered (`summarise`).
  - [x] "Nothing on <day> needs you right now." empty state.
  - [x] Pressing list (`needingAttention`), each person: name, `describeDay` on the right.
  - [x] Overloaded line: "N minutes more than the day holds (planned, available)".
  - [x] Blocked rows: task name, reason, "— who can clear it".
  - [x] Contradiction rows: "task: said started, the board still says pending".
  - [x] needsManager rows: "task — answer" + optional note.
  - [x] Footnote: "An unanswered question is a question, not a verdict…"
- [x] "All Projects" list: cover image, name, publish/pipeline badges, client · location, approvals/comments counts, updated date. Empty state.
- [x] Sidebar badge counts (`getAdminBadges`) carried in `home/overview` for the tab bar / More badges (App owns the actual badge wiring; not this area's file).

## Activity / Alerts (`AlertsRootView`, pushed)
- [x] Title + subtitle with unread count.
- [x] "Mark all read" when `unread > 0` (`clearAdminAlerts`).
- [x] Empty state ("Nothing yet").
- [x] List newest first: left accent on unread, a colour dot (employee colour or grey), title, message, day · time.
- [x] Tap marks the one alert read (app-only affordance, `home/markAlertRead`; the website has no per-alert read).
- [x] Swipe to mark read.
- [ ] Full deep link to the alert's own admin screen (`alert.url`) — **not built**: the target
      screens (tasks, employees, supply requests) belong to other areas' native views, and this
      area may not add navigation into them. Tapping marks it read instead of opening anything.

## Reviews (`ReviewsRootView`, pushed)
- [x] Title + explanatory subtitle.
- [x] Empty state ("Nothing waiting").
- [x] Per submission: photo (image) or file icon + label, context (project name or "Handed out by you"), task/job name, employee · day time, note.
- [x] `SubmissionChecks`, matched exactly: "Not checked" note when `checkedAt` is null; "nothing to check" amber note when checks is empty; otherwise each criterion with its verdict styling —
      met (green), partly (amber), **not-met (red/pink)**, **cannot-tell (grey, question mark)**, needs-human (purple) — required text, evidence, gap, outcome label, and the disclaimer line.
- [x] Approve / Send back with a note field; send-back refuses an empty note ("Tell them what needs redoing.").

## Analytics (`AnalyticsRootView`, pushed)
- [x] Daily progress: day heading ("Today · …", "Yesterday · …", "Tomorrow · …", or the date), prev/today/next day controls.
- [x] Whole-team day summary or "Nothing was on anyone's list this day."
- [x] Per person day card: colour dot, name, role, percent (or "—"), "<done> of <total> done", state bar + legend, "Working on now" (live day only), 7-day strip (tap a day to jump).
- [x] Monthly progress: period heading, prev month / this month controls.
- [x] Four stats: Team, Average progress, Below N%, Deductions applied.
- [x] Shortfall banner with the exact singular/plural sentence, and "Apply deduction(s)" with a confirm step (`applyPerformanceDeductions`, i.e. `runPerformanceReview`).
- [x] Per-employee rows: colour dot, name, role, progress bar + percent (red under target), Done/Review/Working/Pending/Late/On-time/Deduction figures. Inactive employees dimmed.

## Not built (see `notImplemented` in the run's report)
- New Project form from the dashboard (`/admin/projects/new`) — creating a project is Projects' area, not Home's.
- Deep links from an alert into another area's native screen.
