# Tasks area — feature inventory

Web sources: `src/app/admin/(dashboard)/tasks/page.tsx` (board, cell editor,
week board / `TaskDialog` from `week-board.tsx`), the process parts of
`src/app/admin/(dashboard)/settings/page.tsx` (sections, steps, task types,
stage periods). Actions: `task-actions.ts`, `task-detail-actions.ts`,
`assigned-task-actions.ts`. Libs: `task-board`, `ownership`, `stage-schedule`,
`stage-deadlines`, `task-types`, `task-graph`, `week`.

Registry: `src/lib/mobile/registry/tasks.ts` (reads `tasks/board`,
`tasks/week`, `tasks/process`; every write listed there). Helpers:
`src/lib/mobile/tasks-board.ts`, `tasks-process.ts`, `tasks-week.ts`.

Everything below is implemented natively unless marked **NOT BUILT**.

## The board (project × step matrix)
- Stat tiles: active projects, steps done/counted, in progress, due tomorrow.
- "Upcoming" panel from the stage periods (task, project, due day).
- Awaiting-review count with a note pointing at the Reviews screen (owned by
  the home area's `ReviewsRootView()`).
- Search projects by name/client.
- Person filter (chip row, "Everyone" + team), filters which cells count for
  a project card.
- Legend toggle: TODO / IN_PROGRESS / SUBMITTED / DONE / TOMORROW badges.
- Mobile layout: a card per project (name, client, done/tomorrow counts, a
  menu with "Start over"), steps grouped by section as chips inside the card
  — not the web's wide table. A chip shows the state icon, the step name and
  a flame for HIGH priority; a red outline marks a blocked cell.
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
- Week navigator (previous/next), weeks starting Sunday, "This week" tag.
- Person filter.
- One section per day of the week with the jobs covering that day; a
  "Nothing planned" empty line; a per-day "+" to create a job on that day.
- Job row: title, owner avatar, day count if it spans more than one day,
  state badge; context menu to set state or delete; tap opens the editor.
- Floating "New job" action defaulting to today.
- Job editor sheet (`TaskDialog` equivalent): title, for (team member),
  starts/ends dates, priority, what to hand in (deliverable), "counts as
  done when" (acceptance), note, and — once a job exists — its own
  TODO/IN_PROGRESS/DONE state buttons and delete-this-job.
- A job that came from a chat task card shows a "from a chat task card" note.
- Delete with confirmation (list swipe and inside the editor).

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

## Known gaps / NOT BUILT
- **Hand out a task** from the Tasks tab still opens the website (see above)
  — needs a native composer in the chat area, out of this area's file
  ownership (`ios/Sources/Features/Chat/**`).
- Everything else in the inventory above is built natively with the design
  kit (spring animations, haptics, skeletons, empty/error/offline states,
  pull to refresh, swipe actions/context menus, confirmation before destructive
  actions, search/filter) and reads/writes only through the `tasks/*` registry.
