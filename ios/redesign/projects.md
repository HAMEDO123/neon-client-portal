# Projects area — redesign progress

Branch `ux-projects` (worktree `/Users/hamedsamir/neon-wt/ux-projects`). Every
screen and sheet of the Projects tab is rebuilt with the kit in `ios/Sources/UI/`
in the language of the Home and Chat mockups. Area-local pieces live in
`Features/Projects/ProjectStyle.swift`, all named `Project…`.

## Screens and sheets (router ids)

| Router id | What | Anchors (`-neonScroll`) |
|---|---|---|
| `projects-list` (also `tab-projects`) | The tab: header, pipeline card, search, publish chips, project cards | `pipeline`, `filters`, `list` (`stats` is gone with the KPI row) |
| `project-detail` | A project's page on Overview | `hero`, `sections`, `link`, `progress`, `figures`, `client`, `details`, `visibility` |
| `project-gallery` | The same page on Gallery, first project that has photos | `hero`, `sections` |
| `project-analytics` | The same page on Analytics | `hero`, `sections` |
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
`sections` puts the top of either in view. Since round 2 the tabs are a
pinned section header, so an anchored card (`progress`, `client`, …) lands
with its first ~60 pt under the pinned tabs: `scrollTo(…, anchor: .top)`
does not know about a pinned header, and a mark placed above the card is
ignored (the lazy stack scrolls to the row's own frame — tried both ways).
Scrolling by hand never does this.

## What changed (round 1 — where round 2 below differs, it wins)

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

## Round 2 — the critic's review of the live screenshots

1. **Tabs first, and pinned.** The eleven tabs sit straight under the hero,
   as a pinned `LazyVStack` section header on a white strip that joins the
   navigation bar once the hero has gone under it. The Client Page card
   (link, share, send, publish) is the Overview's first card. Changing tab
   scrolls to the tabs (`withNeonAnimation(.snappy)`), so Gallery and
   Analytics show their own content on the first screen.
2. **One pipeline map.** `ProjectPipelineStyle.hue/label` now read Home's
   `HomePipeline` (Home had already shipped its round with its own map, so
   following it is the one way both tabs agree without editing Home). The
   list's pipeline card uses Home's legend layout: up to four statuses on one
   row, more three to a row, grey dots a shade darker as the kit's legend
   draws them; each entry still filters the list. The filter sheet, cards,
   hero and edit menu use the same words ("Sent to Client").
3. **"Draft" is the pipeline's word only.** The publish state reads
   Published / **Not published** (غير منشور) / Archived everywhere in the
   area; on a card's photo it is an icon alone (checkmark.seal / eye.slash /
   archivebox) with the name as its accessibility label, so the status pill
   under the name is the card's one status word.
4. **Nothing reaches the client on one tap.** Send to Client and Send Update
   ask first, naming the client, the number and the first line of the
   message the server sends (its English text, `sendProjectWhatsApp`); with
   no number on file the server says so itself and nothing is sent.
   Unpublish confirms ("The client's link stops opening until you publish
   again."). Regenerate Link moved to the ⋮ menu (destructive, still
   confirmed); the grid is Copy · Preview · Share over Send to Client · Send
   Update.
5. **Analytics tell the truth.** Four compact figures: Opens, Downloads (every
   `downloaded_*` kind — the gallery PDF was missing from the server's sum),
   Responses, Comments. Renders Viewed is gone until the client page logs
   `viewed_render`; All Activity was the breakdown's sum; the footnote went
   with them.
6. **Arabic hero on one edge.** `ProjectHero` (area-local, the kit's look)
   sizes the name and client line to their words, so eyebrow, name, client
   line and pills share the leading edge (the right in Arabic) while each
   string keeps its direction; `neonDisplay` / `neonSubtitle`, capped at
   xxxLarge to stay inside the photo. The kit's `HeroHeader` still fills —
   see Open issues.
7. **Viewer status bar.** `.preferredColorScheme(.dark)` on the viewer (it is
   always a full-screen cover, from the gallery and from Chat), so the clock
   and signal are white on black. The photo shows the gallery's smaller copy
   at once when one is in memory, with a small frosted spinner; otherwise a
   large white spinner.
8. **Stage without a scroller.** An eight-step bar (done blue, current indigo,
   to come grey) and one line: "Stage 5 of 8 · BOQ — next: Pricing". The
   card no longer says the stage twice.
9. **A project on arrival.** The KPI row is gone (Home owns those figures);
   the pipeline card's subtitle says "4 projects · 0 approvals waiting", the
   list header "Newest update first · 2 updated this week" (with plurals);
   no header subtitle; covers are 140 pt.
10. **Status-bar band.** The tab paints the page's own `NeonAmbient` over the
    status bar, fading out just below it (Home's technique), so the title,
    buttons and chips never run under the clock. The project page's bar turns
    solid white once the hero has gone, and takes the project's name then
    (empty while the hero shows it).
11. **Filter colours mean one thing.** Pipeline chips keep their dots (Home's
    colours); Archived gets the archivebox symbol; stages are neutral chips
    numbered ① … ⑧.
12. **Plurals.** `projectPlural(count, one:other:)` — English one/other,
    Arabic zero/one/two/few/many/other read from `"<key>#<category>"` in
    Projects.strings (falls back to the plain key). A `.stringsdict` was not
    used because it follows the phone's language, and the app's language is
    chosen in the app. Spaces, photos, points, projects, approvals, "updated
    this week", "N of M projects shown", unreadable photos and "Nm/h/d ago".
13. **Client card.** Name, then the phone (left to right) under it, call and
    email buttons, email as a row; the project type lives only in Details.
    Area shows "120 m²" when it is a number; New/Edit take it in a
    `NumberField` with an m² unit (an area saved as free text, like
    "300–350", stays a text field in Edit and is never rewritten).
14. **Real switches.** Client Visibility is six `ToggleRow`s that save on the
    spot (`updateProjectSettings`, all six together, one save at a time, the
    last flip wins), put back with the server's sentence on a refusal; no
    Edit capsule; titles stay dark whichever way a switch is set.
15. **Toolbar.** A plain ellipsis in the system's own glass.
16. **Forms.** Prompts are examples ("e.g. Lina Haddad", name@example.com,
    07X XXX XXXX, "e.g. Amman, Abdoun", "e.g. Interior design", "e.g. Seating
    Area"); "Optional" is a field hint, not a label suffix; Add a space opens
    at the medium detent.
17. **Remove cover.** A frosted "Remove" capsule beside "Replace" on the
    photo; tapping it shows the no-cover state with Undo, applied on Save
    (or drops a photo just picked).
18. **Hotspot targets.** Pins are touched at 44 pt (drawn at 26); delete is 44
    pt; a whole row is a button that highlights its pin and scrolls the photo
    into view.
19. **FAB corner.** "7d ago" moved to the name's row; the chevron is gone (the
    card is the link); the percentage sits beside the status pill.
20. **One Arabic register.** Projects.strings is Modern Standard Arabic
    throughout (no بيقدر/هال/مش/لسا/شي/هون/بعدين…).

Skipped: the kit's disabled `NeonButton` contrast (16, first half) — it lives
in `ios/Sources/UI/Buttons.swift`, which this area does not edit.
Kept: the filter sheet's chips still wrap (`FlowRow`); a two-column grid of
equal chips would cut "Changes Requested" and "Technical Drawings" short.

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

- Kit: `HeroHeader` renders its title and subtitle with `DirText(fill: true)`
  and fixed `.system(size:)` fonts, so a Latin name on an Arabic page starts
  from the left while the eyebrow and pills sit on the right. The area draws
  `ProjectHero` meanwhile; the fix belongs in `Hero.swift` (`fill: false`,
  `.neonDisplay` / `.neonSubtitle`), after which `ProjectHero` can go.
- Kit: a disabled `NeonButton` lowers its opacity (white on pale lavender,
  about 1.5:1); a sunken fill with a tertiary label would read as "not yet".
- Kit: the pipeline's colours and words live in Home's `HomePipeline`; they
  belong next to `statusTone()` in the kit, and the status-bar band is drawn
  twice (Home's `HomeStatusBarFade`, this area's `ProjectStatusBarScrim`) —
  one `NeonScroll` option would serve every tab.

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
