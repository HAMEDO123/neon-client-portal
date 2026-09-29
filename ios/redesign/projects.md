# Projects area — redesign progress

Branch `ux-projects` (worktree `/Users/hamedsamir/neon-wt/ux-projects`). Every
screen and sheet of the Projects tab is rebuilt with the kit in `ios/Sources/UI/`
in the language of the Home and Chat mockups. Area-local pieces live in
`Features/Projects/ProjectStyle.swift`, all named `Project…`.

## Screens and sheets (router ids)

| Router id | What | Anchors (`-neonScroll`) |
|---|---|---|
| `projects-list` (also `tab-projects`) | The tab: header, KPI cards, pipeline bar, search, publish chips, project cards | `stats`, `pipeline`, `filters`, `list` |
| `project-detail` | A project's page on Overview | `hero`, `link`, `sections`, `progress`, `figures`, `client`, `details`, `visibility` |
| `project-gallery` | The same page on Gallery, first project that has photos | `hero`, `link`, `sections` |
| `project-analytics` | The same page on Analytics | `hero`, `link`, `sections` |
| `project-new` | New Project sheet | — |
| `project-edit` | Edit Project sheet (first project) | — |
| `project-filter` | Filter sheet, with the real list's counts | — |
| `project-add-space` | Add a space sheet | — |
| `project-add-photos` | Add Photos sheet (first project with a space) | — |
| `project-hotspots` | Hotspot editor (first photo with hotspots, else the first photo) | `photo`, `form`, `list` |
| `project-viewer` | Full-screen viewer on the first space with photos | — |

Anchors inside the gallery and analytics tabs are not reachable: those tabs
are one view each (the gallery owns its sheets and the analytics its load), and
`scrollTo` cannot reach an id nested inside one row of the page's lazy stack.
`sections` puts the top of either in view.

## What changed

- **List** — no navigation bar: a `ScreenHeader` ("Projects", "Every client
  project, newest first") with a list/grid toggle and a Filters button that
  carries the number of active filters. Four compact `KPICard`s (total,
  published, pending approvals, updated this week — the server's figures, no
  invented trends or bars). A **Project Pipeline** `SectionCard`: a
  `SegmentedProgressBar` of the projects by pipeline status and a key whose
  entries filter the list. `SearchField` (name, client and now location).
  Publish filter as `FilterChips` with counts — **the raw "publish.PUBLISHED"
  key is fixed** (`localizedEnum`, not `L`). Active pipeline/stage filters
  show as removable chips. Projects are cover-led cards (publish state,
  approvals and comments counts and the journey stage on the photo; name,
  client · place, pipeline status, "updated 2d ago" under it), or two to a
  row in grid mode (remembered per phone). A project with no cover gets its
  own pastel and "No cover photo yet" rather than a grey box. "New Project"
  is the floating button (manager only), and a new project opens straight
  away. Empty states tell "no projects at all" from "nothing matches", with
  Clear Filters.
- **A project's page** — the kit's `HeroHeader` with the cover (from the
  list's row at once, so it opens on the picture), client · place, the
  pipeline status (pulsing while it waits on the client or is being built)
  and the publish state. A **Client Page** card: the link in a capsule (tap
  to copy), six action tiles — Copy Link, Preview (now opens the page, as the
  website's Preview does), Share (the old share sheet), Send to Client, Send
  Update (each shows its own spinner and blocks a second send), Regenerate
  (confirmed) — and Publish / Unpublish / Archive (confirmed). The eleven tabs
  as `FilterChips` with counts where the page knows them (photos, approvals,
  comments). The employee-side live banner is kept, word for word.
- **Overview** — Progress card (completion ring, pipeline status, delivery
  date, the journey `StageTrack`), four figures that open their tab (spaces,
  photos, approvals, comments), Client card (call and email buttons, email,
  phone), Details card (location, area, type, delivery, sold on, description)
  and Client Visibility card (each switch On/Off), both with an Edit link.
- **Gallery** — a summary card ("3 spaces · 24 photos", Add a space), and
  per space a card: name, count, camera button, menu (Add Photos, Remove
  Space). Photos as a mosaic — the first large with its caption, the rest
  three to a row through `RemoteImage` — with Cover, Before/After and hotspot
  count badges, and an Add tile at the end. An empty space is one large "add
  the first photos" target. Long-press keeps Hotspots / Set as Cover / Delete.
- **Viewer** — shared with Chat, API unchanged for it. Now: title and
  "3 of 12", tap to hide the chrome, a thumbnail strip, the caption in its
  own direction, a **Before | After** switch for before/after pairs (the
  "before" photo was uploaded but never shown anywhere in the app), the
  photo's **hotspots** drawn on it (toggle), and from the gallery an action
  bar: Hotspots, Set as Cover, Delete (acted on after the viewer closes).
- **Hotspot editor** — the photo at its **real proportions** (it was cropped
  to a fixed 0.72 frame, so a point placed on a wide render landed somewhere
  else on the client's page), numbered pins in their category's colour, a
  pulsing marker for the new point, the form scrolls into view, categories
  as coloured chips, and the placed points as a list (tap to find the pin,
  remove with confirmation).
- **Add Photos** — Photos | Before / After switch; "From the library" and
  **"Take a photo"** (the camera — FEATURES.md said it existed; it did not);
  thumbnails of what was chosen, removable; per-photo progress (spinner,
  tick, failure) and an "N of M uploaded" bar. A failed upload stops at the
  server's first refusal, keeps what went up, refreshes the gallery, and the
  button becomes "Upload the rest" — a retry never sends a photo twice. A
  photo the phone cannot read is reported instead of silently skipped.
- **Analytics** — six compact figures (opens, renders viewed, downloads,
  approval responses, comments, all activity); a breakdown as rows with a
  share bar each (the website's event names are sentences a chart key cut
  short); Recent Activity as a timeline. **Renders Viewed** carries a note:
  the client page never logs `viewed_render` (README, Known issues), so its 0
  is "not recorded", not "not looked at".
- **Sheets** — New Project (shorter subtitle, field symbols, "only the name is
  needed" footer, which is what `createProject` requires); Edit (the cover
  large with Replace on it, Remove as a toggle, a bar under Completion %,
  symbols on the visibility switches); Filter (chips with colour dots and
  counts instead of two menus); Add a space (room suggestions a tap away).

## Server (additive)

`projects/list` rows carry `completionPercent` (already on the row
`getProjects()` returns). `ProjectSummary.completionPercent` is optional, so a
server without it (the live one until this merges) simply shows no
percentage on the cards. `npx tsc --noEmit`, `npm run lint` (0 errors),
`npm test` (0 failures) pass.

## Deliberately kept

- Every action, guard and confirmation: delete (manager only, toolbar menu),
  archive, regenerate, remove space/photo/hotspot all confirm; create stays
  manager-only; the team sees the live/not-live banner.
- One photo per request; compression always on (see FEATURES.md).
- The eleven tabs and the projectfiles area's sections, unchanged.
- The Chat viewer's call (`ImageViewerPayload(items:startIndex:)`) and
  `[safe:]`.

## Open issues

- Kit: `PillFilterBar` truncates ("Publis…", "Archi…") instead of scrolling
  when four English options don't fit — its `ViewThatFits` accepts the even
  row because the texts compress. The list uses `FilterChips` instead.
- Kit: `BadgeTone`/`StateBadge` have seven colours, so the nine pipeline
  statuses would share oranges; the area draws its own `ProjectStatusPill`
  from `NeonHue`.
- Kit: no `QuickActionTile` with a busy state; the area's
  `ProjectActionTile` copies its look and adds a spinner.
- Anchors inside the gallery and analytics tabs don't scroll (see above).
- Checked on the simulator only with the list's DEBUG fixture
  (`-uiTestMode`, no network) and a response cache filled locally with
  made-up JSON and local images (not committed); nothing ran against the
  live server. Live screenshots still to come from the orchestrator.
