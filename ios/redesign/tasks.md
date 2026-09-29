# Tasks — redesign progress

The manager's Tasks tab, rebuilt on the kit (`ios/Sources/UI`) in the
mockups' language: one scrolling page with a `ScreenHeader` ("Tasks", a grey
line that follows the segment, the Reviews seal with its count, the delivery
process button, the account menu) and the kit's `SegmentedPill` (Board /
Week / Chat / Team), then the chosen segment's cards. Every sheet ends in
`.neonSheet`, every page paints nothing of its own, motion comes from
`NeonMotion`, and every new string is in `ar.lproj/Tasks.strings`.

Files: everything in `ios/Sources/Features/Tasks/`. Area-local pieces live in
`TasksKit.swift` (named `Tasks…` so they never collide with the kit).

## Screens and sheets (debug router ids)

| Screen / sheet | Id | Anchors (`-neonScroll`) |
|---|---|---|
| Tasks tab, Board segment (`TasksRootView` → `TaskBoardView`) | `tasks-board` (and `tab-tasks`) | `progress`, `upcoming`, `projects` |
| Week segment (`WeekBoardView`) | `tasks-week` | `days` (and `day-YYYY-MM-DD` per day) |
| Chat segment (`ManagerTasksView`) | `tasks-chat` | — |
| Team segment (`TaskPeopleView`) | `tasks-team` | `team`, `people` |
| One person's list (`TaskPeopleDetailView`, pushed from Team) | `tasks-person` (first person given work this week) | `lists` |
| Cell editor sheet (`CellEditorSheet`) | `tasks-cell-editor` (a cell with a word from the team, else an open one) | — |
| New job sheet (`JobEditorSheet`, the floating "New job" or a day's +) | `tasks-job-new` | — |
| Edit job sheet (`JobEditorSheet` on a job) | `tasks-job-edit` (this week's first job, else last week's) | — |
| Delivery process (`ProcessSettingsView`, pushed) | `tasks-process` | `sections`, `steps`, `owners`, `periods` |
| Section sheet (edit / new) | `tasks-process-section`, `tasks-process-section-new` | — |
| Step sheet (edit / new) | `tasks-process-step`, `tasks-process-step-new` | — |
| What this kind of work needs (`ProcessTaskTypeSheet`) | `tasks-process-standard` | — |
| Owner sheet (edit / new) | `tasks-process-owner`, `tasks-process-owner-new` | — |
| Stage period sheet (edit / new) | `tasks-process-period`, `tasks-process-period-new` | — |

Reused, not mine: `ReviewsRootView` (Home insights), `ChatRoomView` and
`ChatCardsLoader` (Chat), `AccountMenu` (kit).

## What changed, screen by screen

- **Board** — the cramped matrix became cards:
  - four `KPICard`s (active projects blue, steps done green, in progress cyan,
    due tomorrow orange) in a compact `StatGrid`;
  - "Where the steps stand": every *counted* step split by state (the same
    set the "Steps done" figure counts, so its parts add up to its total) as a
    segmented bar and a dot key, a ring with the share done, and the key to a
    chip's marks with counts (high priority, blocked, not counted);
  - "N awaiting your review" card → Reviews (only when there is any);
  - "Upcoming" from the stage periods: cover, step, project, due day (red
    "Was due …" once late), its state badge; a row opens that cell's editor;
  - Projects: search, "Hide completed", the person chips (initials on each
    person's colour), then one card per project — cover, name, client, a ring
    with its share of counted steps done, a bar split by state, done /
    tomorrow / blocked / high counts, the ⋮ "Start over" menu, and the steps
    as state-coloured chips grouped under their section (dot in the section's
    colour, done/counted per section). Blocked chips carry a red edge and
    mark, HIGH a flame, not-counted steps are faded.
- **Cell editor** — a summary card (cover, section, state, HIGH / Blocked /
  Not counted, who is on the hook), the state as three tiles with their own
  spinner (immediate, not part of Save — as on the web), the team's last word
  with its time and "Next:", then Assignment, What finishing means, Notes,
  Blocked, Waits for, and "Clear scheduling" (confirmed).
- **Week** — a week card (navigator with "This week" / "Back to this week",
  a seven-day strip with today in the brand gradient and a dot where work
  falls — tapping a day scrolls to it — the week's job count and its split by
  state), the person chips, then one card per day (date tile, weekday,
  "Today" tag, job count, a + for a job on that day) with its job rows
  (avatar, title, person, span, state badge, flame, chat-card mark; context
  menu to set state or delete). The floating "New job" stays on this segment.
- **Job editor** — state tiles for an existing job (immediate), "Sent for
  review" and "From a chat task card" notes, the team's last word, then Job,
  When (with "Runs N days"), What it takes, and "Delete this job" (confirmed).
  New jobs hand out with the brand button.
- **Chat** — Reviews and "Hand out a task" as entry cards, the kit's
  `PillFilterBar` (Open / To review / Done / All, with the review count), and
  each chat task card on its own card: state tile, title, overall state,
  conversation, due (red once late), HIGH, and a chip per person with where
  their part stands.
- **Team** — a card with the Week/Month pill and the period navigator; "The
  team" card (everyone's done of given, a ring, the split by state, overdue in
  red); then a card per person washed in their board colour: avatar, role,
  "x of y done", a big ring (green with a seal at 100%, dashed with a dash
  when nothing was given), the split bar, count chips and board-steps / jobs.
- **Person** — header card with a 128 pt ring, then "Where it stands" and the
  lists (Overdue, Still to do, Sent for review, Done) as section cards; a board
  step opens the cell editor.
- **Delivery process** — three KPI cards (sections, steps, owners with the
  inactive count), the timed process as a coloured bar with each range's
  days, a warning card for steps with no standard, then sections, steps
  (grouped by section), owners and stage periods as row cards with a dashed
  "Add …" card each. Swipes and long-press menus kept.
- **Process sheets** — `SheetScaffold` forms; the section colour as swatches.

## Deliberately kept

- Every action, sheet and path of before: reset a project, set a cell's state,
  save / clear a cell, create / edit / delete / set state on a job, every
  process create / edit / delete / move, the task-type standard, the people
  lists opening the cell editor, Reviews, the team chat for handing out.
- The platform's refusals: state tiles set only what the web's board and
  week board set; SUBMITTED is "Sent for review" and waits in Reviews;
  nobody given work reads "Nothing given this week/month" and a dashed ring,
  never 0%; empty states say what is and isn't known.
- Real data only: every figure is read from `tasks/board`, `tasks/week`,
  `tasks/people`, `tasks/process` or the chat cards. Nothing invented.

## Changed on purpose

- The board's legend toggle is gone: the key is always on the "Where the
  steps stand" card.
- Week jobs lost the list swipe to delete (the days are cards on a scroll,
  not a `List`); delete is on the row's long-press menu and in the editor.
- Dates inside the area are short ("Sep 29", the year only when it differs;
  "Sep 27 – Oct 3, 2026" for a range) so rows don't truncate, in Arabic too.
- A stage period's arrow points the way its names read (→ / ←).

## Open issues

- Kit: `MenuField` shows its placeholder ("Choose…") when the selection is
  nil even when a `noneTitle` is given; the area passes the none title as the
  placeholder, so it shows in the placeholder's faint grey.
- Kit: `FormSection` titles are uppercased with tracking; letter-spacing
  breaks Arabic joining ("الحالة" reads spaced out).
- Several of this table's keys are shadowed by `Localizable.strings` or an
  earlier table (e.g. "Done", "To do", "%d of %d done") — `L()` takes the
  first table that has a key — so the Arabic shown there is the other table's.
  Every key has a translation; only the wording differs slightly.
- "Hand out a task" opens the team chat; composing a task card is the chat
  area's sheet.
- Live screenshots with real studio data still to be taken by the
  orchestrator.
