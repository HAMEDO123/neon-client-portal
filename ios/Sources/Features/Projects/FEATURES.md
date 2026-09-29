# Projects area — feature inventory

Read from `src/app/admin/(dashboard)/projects/**`, `src/app/employee/(portal)/projects/**`,
`src/components/admin/{link-actions,publish-controls,project-tabs,hotspot-editor,image-upload-form}.tsx`,
`src/lib/actions/{project,gallery,hotspot,employee-project,whatsapp}-actions.ts` and `src/lib/queries.ts`.

## webFeatures (every screen, field, button, filter, rule this area owns)

**List** (no dedicated admin page today — the team's `/employee/projects` is
the closest web equivalent; this app gives both sides one list, `requireStaff`):
- Every project, newest updated first; cover thumbnail, name, client, location.
- Studio figures: total, published, pending approvals, updated this week (`getDashboardStats`).
- Publish-state badge, pipeline-status badge, approvals count.
- New Project (manager only — `createProject` is `requireAdmin`).

**Project page** (`[id]/layout.tsx`, both portals, `ProjectTabs`):
- Name, publish-state badge, client name.
- `PublishControls`: Publish / Unpublish, Archive (confirm).
- `LinkActions`: the client link, Copy, Preview, Send to Client (WhatsApp),
  Send Update (WhatsApp), Regenerate (confirm) — direct send when the worker/
  Cloud API is configured, `wa.me` otherwise (this app always calls the
  action; `sendProjectWhatsApp` already degrades to a message when neither
  is configured, so no separate `wa.me` path was needed).
- Eleven tabs: Overview, Gallery, Drawings, BOQ, Pricing, Materials,
  Furniture, Documents, Approvals, Comments, Analytics.
- Employee side: an amber banner ("this project is live…" / "not published
  yet…") above the tabs. **Not implemented** — low-value restatement of the
  publish badge already shown; noted below.

**Overview** (`[id]/page.tsx`, `updateProjectOverview`, `updateProjectSettings`, `deleteProject`):
- Cover image: upload, replace, remove.
- Name, client name/email/phone, delivery date, location, area, project type, description.
- Pipeline status (9 values), journey stage (8 values), completion %.
- Sold by (from `sellers()` — active employees) / Sold on.
- Client Visibility: showPricing, showDetailedPricing, showBoqQuantities,
  showBoqPrices, allowDownloads, watermarkEnabled.
- Danger Zone: Delete Project (confirm, manager only — `requireAdmin`).
  Implemented as a toolbar menu item rather than a standing red section (same
  guard, same confirmation, less permanently alarming on a phone).

**Gallery** (`[id]/gallery/page.tsx`, `gallery-actions.ts`, `hotspot-actions.ts`, `image-upload-form.tsx`):
- Spaces: add, remove (confirm, cascades its images).
- Images: upload one or several (one request per photo — the documented
  reason, see `image-upload-form.tsx`'s own comment), optional shared
  caption, optional client-side compression, before/after pairing, delete
  (confirm), full-screen viewer (swipe between a space's photos, pinch-zoom).
- Hotspots: click/tap to place, label, category (5 values), reference,
  description; list with delete.
- Set an existing gallery image as the project's cover — no website action
  does this yet (the admin form only uploads a new file or clears it); added
  as new logic, `src/lib/mobile/registry/projects.ts` `projects/setCover`,
  guarded the same as every other project write.

**Analytics** (`[id]/analytics/page.tsx`, `getProjectAnalytics`):
- Five stat cards: opens, renders viewed, downloads, approval responses, comments.
- Activity breakdown by type, as bars.
- Recent activity feed with relative time.

**New Project** (`new/page.tsx`, `createProject`, manager only):
- Name, client name/email/phone, delivery date, location, area, project type, description.

**Not this area's:** Drawings, Documents, BOQ, Pricing, Materials, Furniture,
Approvals, Comments — the projectfiles area's own reads/actions, embedded
here via `ProjectDrawingsSection(projectId:)` … `ProjectCommentsSection(projectId:)`.

## Implemented

- `ProjectsRootView()` — tab root, `NavigationStack`, both sides.
- `ProjectListView` (in `DashboardView.swift`) — search, publish-state
  filter chips, stats, rows, pull to refresh, New Project (manager only).
- `NewProjectSheet` — the new-project form.
- `ProjectDetailView` — hero, publish controls, link actions, the eleven
  section tabs (`FilterChips`), Edit / Delete in a toolbar menu.
- `ProjectOverviewContent` + `EditProjectSheet` — every overview and
  visibility field, cover upload/replace/remove, Sold by/Sold on.
- `ProjectGalleryView` + `AddPhotosSheet` + `HotspotEditorView` — spaces,
  one-photo-per-request upload (library, several at once, or camera),
  before/after pairs, delete, set cover, tap-to-place hotspots, full-screen
  viewer with hotspot count badges.
- `ProjectAnalyticsView` — stat cards, activity breakdown bar chart, recent
  activity feed.
- `src/lib/mobile/registry/projects.ts` — every read (`requireStaff`) and
  action above; create/delete stay `requireAdmin` inside the website's own
  actions, and the app hides those buttons for the team to match.

## notImplemented

- ~~**The employee-side amber "this is live" banner.**~~ Done: shown on
  `ProjectDetailView` only when `api.side == .employee`, in the employee web
  page's own words (`src/app/employee/(portal)/projects/[id]/layout.tsx`) —
  "This project is live. Anything you add or remove here changes the
  client's page straight away." / "This project is not published, so the
  client sees nothing until somebody publishes it." No server change: it
  reads the `publishState` the detail read already returns.
- ~~**Filtering the list by pipeline status or journey stage**~~ Done: a
  "Filters" button beside the publish-state chips opens `ProjectFilterSheet`
  — two `MenuField`s (the same component and the same
  `ProjectConstants.pipelineStatuses`/`projectStages` the Overview edit
  sheet already offers), applied live, ANDed with the publish filter and
  search. `currentStage` (journey stage) is new on `ProjectSummary` and on
  `projects/list`'s mapped rows — `getProjects()` already `include`s the
  whole `Project` row, so this is one added field, not a new query.
- **The `compress` upload checkbox.** The website lets a person turn client-
  side compression off for a full-quality upload; this app always compresses
  (`UploadMaker.photo`, 2400px / 0.82 quality) since a phone's camera photos
  are the common case this exists for. `addGalleryImage(..., compress:)` on
  the server side still accepts either, so exposing a toggle later is a
  one-line change in `AddPhotosSheet`.

## Redesign (branch ux-projects) — what the app now does beyond the list above

See `ios/redesign/projects.md` for every screen. Behaviour that is new or fixed:

- **Camera in Add Photos.** "(library, several at once, or camera)" above was
  written before the camera existed in the sheet; it does now ("Take a photo").
- **Retry sends only what didn't go up.** A failed upload keeps the photos that
  reached the server (the gallery refreshes) and the button becomes "Upload
  the rest"; an unreadable photo is reported rather than skipped silently.
- **Hotspots are placed on the whole photo.** The editor showed the photo
  cropped to a fixed frame, so x/y percentages did not match what the client
  sees; it now shows the photo at its own proportions.
- **Before/after pairs and hotspots show in the viewer.** The "before" photo was
  uploaded but never shown in the app; the viewer switches Before | After and
  draws the photo's hotspots.
- **Preview opens the client's page** (the website's `<a target=_blank>`);
  sharing the link is its own Share tile.
- **The publish filter's labels** read "Published / Draft / Archived" (the chips
  showed the raw key `publish.PUBLISHED`).
- **Renders Viewed** carries a note that the client page does not log render
  views (README, Known issues) — its 0 is "not recorded".
- `projects/list` rows carry `completionPercent` (additive), shown on the cards.
