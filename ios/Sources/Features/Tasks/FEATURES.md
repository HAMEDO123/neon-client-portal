# Tasks area — feature inventory

Web sources: `src/app/admin/(dashboard)/tasks/page.tsx` (board, cell editor,
week board / `TaskDialog` from `week-board.tsx`), the process parts of
`src/app/admin/(dashboard)/settings/page.tsx` (sections, steps, task types,
stage periods). Actions: `task-actions.ts`, `task-detail-actions.ts`,
`assigned-task-actions.ts`. Libs: `task-board`, `ownership`, `stage-schedule`,
`stage-deadlines`, `task-types`, `task-graph`, `week`.

Registry: `src/lib/mobile/registry/tasks.ts` (reads `tasks/board`,
`tasks/week`, `tasks/process`, `tasks/people`; every write listed there).
Helpers: `src/lib/mobile/tasks-board.ts`, `tasks-process.ts`, `tasks-week.ts`,
`tasks-people.ts` (+ the pure `tasks-people-rules.ts`).

Everything below is implemented natively unless marked **NOT BUILT**.

## The board (project × step matrix)
- Four KPI cards: active projects, steps done/counted, in progress, due tomorrow.
- "Where the steps stand": every counted step split by state (bar + key),
  a ring with the share done, and the marks' key (high priority, blocked,
  not counted) with their counts — always shown, replacing the old legend toggle.
- Awaiting-review card (when there is any) opening the Reviews screen (owned
  by the home area's `ReviewsRootView()`); the header's seal button opens it
  too, with the count as its badge.
- "Upcoming" card from the stage periods (task, project, due day — red once
  late); tapping a row opens that cell's editor.
- Search projects by name/client; "Hide completed" hides DONE steps.
- Person filter (chip row, "Everyone" + team), filters which cells count for
  a project card.
- Mobile layout: a card per project (cover, name, client, a ring with its
  share done, a bar split by state, done/tomorrow/blocked/high counts, a
  menu with "Start over"), steps grouped by section as chips inside the card
  — not the web's wide table. A chip shows the state icon and colour, the
  step name and a flame for HIGH priority; a red outline marks a blocked cell;
  a step not counted in progress is faded.
- Tapping a chip opens the cell editor sheet.
- "Start over" (reset project tasks) with a destructive confirmation.
- Pull to refresh; offline banner with cached-at time; error/retry state;
  skeleton loading via `LoadStateView`.

## The cell editor (sheet)
- State: TODO / DONE / TOMORROW as immediate one-tap actions (mirrors the
  web's click-to-cycle), separate from the Save button.
- Shows the last update note from the team, when there is one.
- Assignee (team member or "whoever owns this step").
- Scheduled-for date, and a due-time field that only appears once a date is
  set (reads `dueTime`, the HH:MM in the company timezone — never `dueAt`
  directly, per the web's own rule).
- Priority (LOW/MEDIUM/HIGH).
- What finishing means: deliverable and "counts as done when" (acceptance),
  each falling back visually to the step's own standard when the cell is
  empty (footer note); estimate hours.
- Note to the team; "not counted in progress" toggle.
- Blocked: reason + who it's blocked by (disabled until a reason is typed,
  matching the web's own gating).
- "Waits for" picker over every other step of the project, with the same
  footer warning the web shows about a cycle being refused whole.
- "Clear scheduling" as its own destructive action with confirmation,
  separate from Save — mirrors `clearTaskEntryDetails` vs `updateTaskEntryDetails`.

## The week board
- Week card: navigator (previous/next, "This week" or "Back to this week"),
  weeks starting Sunday; a strip of the seven days (today in the brand
  gradient, a dot where jobs fall; tapping a day scrolls to it); the week's
  job count and its split by state.
- Person filter.
- One card per day of the week with the jobs covering that day; a
  "Nothing planned" line; a per-day "+" to create a job on that day.
- Job row: title, owner avatar, day count and span if it runs over more than
  one day, state badge, flame for HIGH, a mark when it came from a chat task
  card; context menu to set state or delete; tap opens the editor.
- Floating "New job" action defaulting to today.
- Job editor sheet (`TaskDialog` equivalent): title, for (team member),
  starts/ends dates, priority, what to hand in (deliverable), "counts as
  done when" (acceptance), note, and — once a job exists — its own
  TODO/IN_PROGRESS/DONE state buttons and delete-this-job.
- A job that came from a chat task card shows a "from a chat task card" note.
- Delete with confirmation (the row's context menu and inside the editor —
  the days are cards on a scroll now, not a `List`, so there is no swipe).

## Process settings (pushed from Settings, no tab stack)
- Timed-process summary (total days), shown only when stage periods exist.
- Sections: list with colour dot, edit sheet (name + colour swatches),
  delete (steps survive ungrouped, message says so), reorder (swipe up/down).
- Steps: grouped under their section, then ungrouped ones; row shows owner,
  estimate, a "No standard" warning badge when deliverable/acceptance are
  both empty; edit sheet (name, owner, section); delete; reorder; a swipe
  action opens the task-type/standard sheet directly.
- Task-type / "what each kind of work needs" sheet: deliverable, acceptance,
  estimate hours, evidence, checklist, auto-accept toggle, reviewer — the
  step's standing standard that a board cell may still override.
- Owners: list with colour, role, "Inactive" badge; add/edit (name, role);
  delete (steps survive unassigned); reorder.
- Stage periods: from-step → to-step, days; add/edit sheet; delete; footer
  explains ranges chaining into derived deadlines.

## Team segment (`tasks/people`)
- Week / Month switch (weeks Sunday–Saturday; month = the payroll month),
  previous / next, "Back to this week"; pull to refresh.
- "The team" card: everybody's period together — done of given, a ring, the
  split by state, and the overdue count; nothing given says so, never 0%.
- A card per active person, in the board's order: avatar, name, role, a big
  animated ring with the percentage done (green with a seal at 100%), or a
  dashed ring and "Nothing given this week" when nothing was given — never 0%.
  Chips: done, sent for review, in progress, to do, overdue (red); board
  steps x/y and jobs x/y.
- Tapping a card pushes the person's list: late, still to do, sent for
  review, done — each row with its state badge and due / completed day.
  A board step opens the existing cell editor (when the board has it).
- What counts: board cells the person owns (`ownedBy`), in the period by the
  analytics page's monthly rule, not "not counted"; plus the jobs handed to
  them that overlap it. Done = DONE (approved); SUBMITTED is "sent for
  review". For a month, `boardCells` equals the web analytics' "Done x/y".

## Chat segment (kept from the pre-existing `ManagerTasksView`)
- Reviews entry point → `ReviewsRootView()` (home area's contract) with an
  unread-count badge.
- "Hand out a task" tile. **NOT BUILT natively** — still opens
  `/admin/chat/team` through `WebPortalLink`/`WebPortalSheet`. Composing a
  task card inside a specific conversation (the `+` → Task flow, or `/task`)
  is the **chat area's** composer (`components/chat/*`), which this area may
  not edit; a native equivalent belongs in the chat area's build-out, not
  here. Left as-is rather than reimplementing chat's compose sheet from this
  area.
- Filter (All/Mine/etc. per `CardFilter`), cached-at banner, chat task cards
  linking into the conversation (`ChatCardsLoader`, owned by the chat area —
  not edited here).

## Faces
- `TasksAvatar` lays a photo over its initials: the person chips over the
  board and the week, a job's owner on the week board, the people on a chat
  task card, the Team segment's cards and a person's page, and the process's
  usual owners. `tasks/board`, `tasks/week` and `tasks/process` carry each
  person's `photoUrl`; `tasks/people`'s `avatar` was already the photo (or the
  initials picture, which `facePhotoURL` reads as none).
- The whole tab re-reads when anybody's face changes.

## Known gaps / NOT BUILT
- **Hand out a task** from the Tasks tab still opens the website (see above)
  — needs a native composer in the chat area, out of this area's file
  ownership (`ios/Sources/Features/Chat/**`).
- Everything else in the inventory above is built natively with the design
  kit (spring animations, haptics, skeletons, empty/error/offline states,
  pull to refresh, swipe actions/context menus, confirmation before destructive
  actions, search/filter) and reads/writes only through the `tasks/*` registry.
