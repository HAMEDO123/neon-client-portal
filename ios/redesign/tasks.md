# Tasks — redesign progress

The manager's Tasks tab, rebuilt on the kit (`ios/Sources/UI`) in the
mockups' language: one scrolling page with a `ScreenHeader` ("Tasks", a grey
line that follows the segment, the Reviews seal with its count, the delivery
process button, a 44 pt account face) and the kit's `SegmentedPill` (Board /
Week / Chat / Team), then the chosen segment's cards. With no bar on the
tab's own page, a scrim in the page's colour sits under the status bar (and
iOS 26's soft scroll edge where there is one), so scrolled cards never print
through the clock. Every sheet ends in
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
| Section sheet (edit / new) — shown as a real half-height sheet over the process page | `tasks-process-section`, `tasks-process-section-new` | — |
| Step sheet (edit / new) — likewise | `tasks-process-step`, `tasks-process-step-new` | — |
| What this kind of work needs (`ProcessTaskTypeSheet`) | `tasks-process-standard` | — |
| Owner sheet (edit / new) — likewise | `tasks-process-owner`, `tasks-process-owner-new` | — |
| Stage period sheet (edit / new) — likewise | `tasks-process-period`, `tasks-process-period-new` | — |

Reused, not mine: `ReviewsRootView` (Home insights; also opened in a sheet
from an editor, "Open in Reviews"), `ChatRoomView` and `ChatCardsLoader`
(Chat). The header's account menu is the area's `TasksAccountMenu` — the
kit's `AccountMenu` items behind a 44 pt face, since the kit's is 30 pt.

## What changed, screen by screen

- **Board** — the cramped matrix became cards:
  - four `KPICard`s, none repeating a figure shown below: active projects
    (blue, "N steps open" under it), done in the last 7 days (green, from
    each counted cell's `completedAt`: the seven days as mini bars and the
    change on the seven before as a trend), in progress (cyan) and tomorrow
    (orange, "steps and jobs"). In progress and tomorrow's steps count the
    same counted set the card below splits, so the KPI and the key agree;
  - "Where the steps stand": every *counted* step split by state as a
    segmented bar and a dot key, a ring with the share done, and the chips'
    marks with their counts ("0 blocked" grey, red only when there is one);
  - "N awaiting your review" card → Reviews (only when there is any);
  - "Due dates" from the stage periods (the server's two per project, six at
    most): "Past their deadline" in red first, then "Coming up"; a row opens
    that cell's editor;
  - Projects: search, "Hide completed", the person chips, then one card per
    project — cover, name, client, ring, bar, counts, the ⋮ "Start over"
    menu — and each section's *open* steps as state-coloured chips, with its
    completed ones folded into one "N completed" chip that unfolds on a tap.
- **Cell editor** — a summary card (cover, section, state, HIGH / Blocked /
  Not counted, "Owner: …"), the state tiles (immediate, as on the web; a
  toast says it is saved; Completed is asked first; the chosen tile has an
  accent ring so grey Pending still reads as chosen; work sent for review
  shows "Open in Reviews" instead of tiles), the team's last word, then
  Assignment, What finishing means, Notes, Blocked, Waits for, and "Clear
  scheduling" (confirmed). Text counters show only near their limit.
- **Week** — a week card (navigator, seven-day strip, the week's count and
  its split by state), the person chips, then one card per day (date tile,
  weekday, "Today", count; an empty day has a quiet "Add a job") with its
  job rows (face in the person's colour, the title starting beside it in its
  own direction, person, span, state badge, flame, chat-card mark; long
  press to set state — Completed asked first, nothing offered for work sent
  for review — or delete). The floating "New job" is the one add button, and
  the list ends clear of it.
- **Job editor** — state tiles for an existing job (as in the cell editor),
  then Job (title, For — nobody until chosen —, priority, and "Counts as
  done when" with a warning while it is empty), When (the area's day fields:
  "Sun, Sep 27" beside the calendar mark, the whole field opening a calendar;
  the span as the Ends hint), What it takes, and "Delete this job". "Hand
  out" is the plain button until the form can go.
- **Chat** — Reviews and "Hand out a task" as entry cards, the kit's
  `PillFilterBar` (Open / Review / Done / All), and each chat task card on its
  own card. Empty: "Hand one out with + in any chat." and "Open team chat".
- **Team** — "The team" card holds the period (a Week / Month `PillMenu` in
  its corner, the ‹ date › navigator under the heading), a ring, what it
  counts ("14 of 19 jobs done"), overdue in words that say what is late, and
  the split; then a white card per person: face in their colour, role, "x of
  y jobs done" (or board steps, or both with a "Board steps · Jobs" line),
  ring, split bar, only the non-zero counts as badges, chevron centred.
- **Person** — no title in the bar (the header card names them), header card
  (face, role, period, 128 pt ring, what it counts), "Where it stands" (two
  to a row, overdue line), then Overdue, Still to do, Sent for review and
  Completed; a group whose name is the state doesn't repeat it on each row,
  a completed row carries only its day, a job shows the days it runs.
- **Delivery process** — the timed process card, the "no standard" note with
  "Write the first one", then Sections, Steps (one card per section), Owners
  and Stage periods (in chain order, as the timeline) — each list one card of
  rows with hairlines, each row keeping its swipes, each heading with its
  count and a + to add. A step's missing standard is an orange mark after
  its owner; an owner with no steps says "No steps yet".
- **Process sheets** — `SheetScaffold` forms at half height (pull up for
  more); "Edit Wael"; a new owner's role and a new section's colour can be
  set at once (written straight after the create, which takes a name only);
  a new stage period starts with neither step chosen; the standard sheet
  says how many checks it has under its title.

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
- "Steps done x/y" left the KPI row (the ring and the key say it); "Done in
  7 days" took its place. The process page's three KPI cards went too — the
  lists' headings carry the same counts.
- Completed, from a tile or a week row's menu, is asked first; work sent for
  review offers no state at all — it is settled in Reviews, beside its proof.
- Days on the Week segment lost their own + (the floating "New job" is the
  add); an empty day keeps a quiet "Add a job".

## Round two — the design review of the live screens

Fixed: the status-bar overlap (area scrim, not the kit — Home and Chat are
theirs), the floating button over Monday's + and Tuesday's last badge, one
colour per person everywhere (`TasksTeamHues`: the board's own colour, with
a repeat moved to a free hue so no two people in a row of chips match), the
Team numbers saying what they count, the Tomorrow and In progress figures,
the KPI row (no repeated figure, a trend and bars), "Due dates", the key's
counts, one vocabulary (`taskStateLabel`), row titles starting beside their
face, one period switch on Team, white person cards, the state tiles, the new
job form, the day fields, the Chat segment's header and empty state, folded
completed chips, the process lists and add buttons, the process sheets, the
44 pt account face and the process glyph, the standard sheet, and the
person page's repetition.

Skipped, and why:
- Counting late board steps into Team (their stage-period deadline) needs
  the server's `tasks/people` read to change; this area may not edit the
  server. The figures now say "jobs" when that is all they count instead.
- The kit's `NeonScroll` scrim, `AccountMenu`, `DateField` and
  `SheetScaffold` bottom bar: the kit is not this area's to edit. The area
  has its own scrim, account face and day field; the sheet's bar is the
  kit's material.
- Undo after a state tap: `Toast` has no action. Completed is asked first
  instead, and every other tap says it was saved.

## Open issues

- Kit: `NeonScroll` has no top scrim when a tab's bar is hidden; every tab
  root without a bar needs one of its own until it does.
- Kit: `MenuField` shows its placeholder ("Choose…") when the selection is
  nil even when a `noneTitle` is given; the area passes the none title as the
  placeholder, so it shows in the placeholder's faint grey.
- Kit: `FormSection` titles are uppercased with tracking; letter-spacing
  breaks Arabic joining ("الحالة" reads spaced out).
- Several of this table's keys are shadowed by `Localizable.strings` or an
  earlier table (e.g. "Review", "%d of %d done", "Coming up") — `L()` takes the
  first table that has a key — so the Arabic shown there is the other table's.
  Every key has a translation; only the wording differs slightly.
- "Hand out a task" opens the team chat; composing a task card is the chat
  area's sheet.
- A new owner's role and a new section's colour are written by a second
  call after the create (the create takes a name only and returns no id);
  the new row is found by name among the ids that were not there before.
- Live screenshots of round two still to be taken by the orchestrator.
