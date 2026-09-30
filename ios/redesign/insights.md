# Insights area — redesign notes

Branch `ux-insights`, worktree `/Users/hamedsamir/neon-wt/ux-insights`. Files
owned: `AlertsRootView.swift`, `ReviewsRootView.swift`, `AnalyticsRootView.swift`,
`HomeInsightsScreens.swift`. `HomeModels.swift` was read-only (Home area's).

All three screens are pushed from More, so they keep the system nav bar per
the kit's rule ("a pushed detail page keeps the system bar") — no
`ScreenHeader` was added, `.navigationTitle` stays.

## Screens covered (debug router ids, unchanged)

- `home-alerts` — `AlertsRootView`
- `home-reviews` — `ReviewsRootView`
- `home-analytics` — `AnalyticsRootView`

No sheets in this area. No new ids were needed; all three existed already in
`HomeInsightsScreens.swift` and still route to the same views.

## Scroll anchors (`-neonScroll <anchor>`)

- `home-alerts`: `row-5` (the 6th alert row, when there are that many).
- `home-reviews`: `second` (the 2nd submission card, when there are ≥2).
- `home-analytics`: `daily` (top of Daily progress), `monthly` (top of
  Monthly progress — the one most likely below the fold), `rows` (start of
  the per-employee monthly progress list).

## What changed

**Alerts** (`AlertsRootView.swift`)
- Row rebuilt on the kit: `IconTile` now carries a per-alert-type `NeonHue`
  (submitted → purple, status change → cyan, overdue → orange, supply →
  amber, chat → indigo, default → grey) instead of one fixed purple for
  every kind, so the feed reads at a glance the way the kit's "one hue per
  idea" rule asks. The employee's own colour is kept as a small ringed dot
  on the tile's corner (was a free-floating dot to the row's left before) —
  it now sits *on* the thing it's telling you about, not detached from it.
- Unread state: `.rowCard(pinned: isUnread, highlighted: isUnread)` — the
  kit's own "this stands out" treatment (indigo/violet accent bar + a
  brighter card) replaces the hand-rolled pink tint + manual left bar.
  Unread tiles are drawn `.filled` (vivid), read ones `.soft` (pastel), so
  the read/unread split doesn't lean on colour alone.
- The header line now carries a real `CountBadge` for the unread count
  instead of folding it into the sentence with `%d new` — the same number,
  read as a badge rather than parsed out of a sentence.
- `EmptyState` now passes `card: true` (a floating pastel-tile card, per the
  kit's own rule for an empty state on a page of cards) and an explicit
  `hue: .indigo`.
- Added `.staggered(index)` on rows arriving, and the `row-5` scroll anchor.
- Kept unchanged: mark-one-read (tap + swipe), Mark all read, the tap-to-open
  routing into tasks/reviews/employees/projects/chat, the offline/error/
  skeleton states, the "not open in the app yet" toast for links this app
  can't follow natively.

**Reviews** (`ReviewsRootView.swift`)
- `EmptyState` now `card: true` + `hue: .indigo`, matching the kit rule.
- Each criterion's verdict now also carries a small uppercase `BadgeView`
  (met → success/green, partly → warning/orange, not-met → danger/red,
  cannot-tell → neutral/grey, needs-a-person → purple) alongside the
  existing icon + tinted-card colouring, rather than a plain uppercase
  `Text`. **The not-met/cannot-tell distinction the platform is careful
  about is unchanged and, if anything, sharper**: not-met is still solid
  red with a minus-circle, cannot-tell is still a grey question mark — the
  badge just gives each its own small pill instead of plain caps text, it
  doesn't change which one is louder.
- Added `.staggered(index)` on submission cards and the `second` scroll
  anchor.
- Kept unchanged: the whole approve/send-back flow, the "not checked" /
  "nothing to check against" notes, the required-note-to-reject validation,
  photo vs. file attachment opening, the disclaimer line under the checks.

**Analytics** (`AnalyticsRootView.swift`) — the biggest change
- Both sections are now `SectionCard`s (icon tile, title, subtitle, a grey
  line, day/period controls as the card's own `trailing`) instead of a bare
  `SectionHeader` floating above plain `VStack`s — the kit's "a block is a
  card, and a card carries its own heading" rule. Daily progress: blue
  calendar tile. Monthly progress: indigo bar-chart tile.
- **The whole-team and per-person "done/review/working/pending" split is now
  `SegmentedProgress`** (the kit's own coloured-parts-plus-dot-legend piece —
  exactly what the mockup's "Project Progress" card uses) instead of a
  hand-rolled bar + hand-rolled legend row. Same four numbers, same colours
  by role (green done, purple review, cyan working, grey pending), drawn by
  the kit component rather than two bespoke views doing the same job.
  Two custom views (`DayCountsBar`, `DayCountsLegend`) were deleted outright.
  `insightsDaySegments(_:)` is the one place that turns `DayStateCounts`
  into `[ProgressSegment]`, used by both the team card and every person
  card.
- **The deductions confirm step now uses `NeonButton`'s own `confirm:` /
  `confirmMessage:`** (a system confirmation dialog) instead of a hand-built
  `confirming` boolean and a Yes/Cancel button pair — same two-step "you're
  about to spend real money" protection, the kit's standard way to ask for
  it, and about 15 fewer lines doing it. The always-visible warning card
  (headline + the JOD sentence) is unchanged; only the confirm step moved
  onto the primitive built for it.
- The employee-colour dot on each `DayPersonCard` / `EmployeeProgressCard`
  moved from a bare `Circle` to the same paired `Circle` + name layout, just
  tidied into one `HStack` — this stayed hand-rolled on purpose: the kit's
  `AvatarView` colours by name hash, not by the studio's own assigned
  employee colour, and swapping to it would silently disagree with every
  other screen that already reads `employee.color`.
- "Working on now" dot now pulses (`.neonPulse(true)`) — a small, real
  motion cue for something that is, in fact, happening right now.
- The 7-day tap-to-jump history strip stayed a local component
  (`InsightsDayHistoryStrip`, renamed and kept private to this file) rather
  than being forced into the kit's `MiniBars`: the kit has no per-bar tap
  target, and "jump to that day" is a real, existing feature this screen
  needs to keep. Documented in `kitRequests` below. Its bars now use a
  green gradient (kit hue tokens) instead of a flat fill.
- Deduction line on an employee's card is now a `BadgeView(tone: .danger,
  symbol: "scissors")` pill instead of a plain red `Label`.
- The per-employee figures grid (Done/Review/Working/Pending/Late/On time)
  kept its bespoke layout (a `LazyVGrid` of small chips) — the kit has
  `StatTile`/`KPICard` for one figure with a title, not six packed at this
  density in one card — but now uses `NeonRadius.sm` instead of a bare `8`.
- Kept unchanged, all real data, nothing invented: daily/monthly figures,
  the day/period paging (`previousDay`/`nextDay`/`today`,
  `previousPeriod`/`thisMonth`), the shortfall banner's exact sentence, the
  per-employee counts and timeliness, inactive-employee dimming.
- No donut/"where the hours went" chart from the mockup was added: the
  platform has no hours-by-category data on this read, and the rules say
  real data only — mapping-to-nearest-real-thing didn't apply here, so it
  was left out rather than invented.

## Kept deliberately (not a gap)

- No `ScreenHeader` on any of the three — they're pushed, not tab roots.
- No RTL-only components used that need extra mirroring beyond what
  `DirText`, `SegmentedProgress` and the charts already handle; nothing here
  draws a raw `Path` or gradient `UnitPoint` of its own.
- iOS 16: nothing added needs an `#available` guard — every kit component
  used already handles that internally.

## kitRequests

- No per-bar tap target on `MiniBars`/the bar-chart family. Analytics' 7-day
  history strip needs "tap a day to jump the whole screen to it," which the
  kit's chart components don't expose, so it stayed a small area-local
  component (`InsightsDayHistoryStrip`). If a future kit version wants to
  fold this in, a `points:` chart with an `onSelect: (Int) -> Void` would
  let this move over without losing the feature.

## Round 2 — design critique fixes

A critic reviewed live screenshots of all three screens (`ux-shots/round1`)
against the mockups' page grammar. Every issue below is that review's; fixed
unless marked skipped, with the reason.

**Analytics** — the big one, fixed:
- **Nested cards (issue 5).** Flattened to the kit's rhythm: `SectionCard`
  now holds only the team's own progress; every person's daily card and
  every employee's monthly card are page-level siblings in `NeonScroll`, not
  cards inside the section card. Fixes the `.id("rows")` bug too (issue 17):
  it's now on a direct child of the scroll, since nothing wraps it.
- **The bar contradicted the numbers (issue 1).** `SegmentedProgress` painted
  every state (including "in progress") as a vivid solid fill, so "0 done,
  15 in progress" read as mostly finished. Both the team card and every
  person card now draw `ProgressBar(progress: done/total, tint: .neonSuccess)`
  — about done work only — with the full split kept in `ProgressLegend`
  underneath, exactly as the mockups' own "Project Progress" card does.
  Same fix for the monthly cards (`insightsMonthSegments`, one vocabulary —
  Done/In review/In progress/Pending — for both the daily and monthly split,
  replacing the old six-chip `LazyVGrid`).
- **"Late 1" beside "On time 100%" (issue 4).** Renamed to what they measure:
  "Overdue now" (open overdue work) and "Finished on time" (only of finished
  work). Below 3 finished items, "Finished on time" now shows "—" and
  `MetaLabel(L("Too few to tell"))` instead of a possibly-100%-from-one-item
  figure — the platform's own MIN_SAMPLE rule, approximated here from
  `counts.completed` since this read has no "finished-with-a-deadline" count
  of its own (documented as a gap below).
- **September 1, 2026 as a month label (issue 6).** `insightsPeriodLabel`
  (local; `homePeriodLabel` is the Home area's own file) starts from
  `date: .omitted` rather than `.long`, so no day survives. Every `%.2f JOD`
  string is now `NeonFormat.money(_, decimals: 0)` passed as `%@` — locale-
  correct digits and currency order in Arabic, not just a suffix.
- **Wrapping headings (issue 7).** Day subtitle is now a short
  `weekday(.abbreviated).month(.abbreviated).day()` ("Wed, Sep 30"). Both
  sections use the same stepper — two `IconButton` chevrons at
  `NeonSize.circleButton` in `trailing` — with the "Today"/"This month"
  return moved into the header's own row instead of a third trailing
  control. (Monthly gained a real "next month" it never had before, since
  paging only ever went backward — computed locally, see below.)
- **9 pt text, faint grey (issue 8).** Fixed sizes → `.neonLabel`/`.neonMeta`
  for small labels, `.neonNumberSmall` for figures. Roles moved from
  `.neonCaption`/`.neonTextFaint` to `.neonSubtitle`/`.neonTextSecondary`.
  Both explainer paragraphs are gone from the daily card (pure methodology
  jargon, no numbers, deleted outright) and reworded/restyled on the monthly
  card rather than deleted outright — it is the one place the deduction
  rule's actual numbers live, so it moved to `.neonCaption`/
  `.neonTextSecondary` instead of `.neonTextFaint`, shortened, with its
  money format fixed (issue 6), rather than being removed and losing that
  information.
- **Person colours disagreeing (issue 9).** Every dot (`employeeFill`) is
  gone from `DayPersonCard` and `EmployeeProgressCard`; both now draw
  `AvatarView(url: nil, name:, size: 36)`, coloured by `NeonPalette.hue(for:)`
  like Home's own avatars. (Photo URLs aren't in this read's employee
  shape, so `url: nil` — initials only, as Home shows before a photo loads.)
- **The strip with no numbers (issue 14).** Each bar is now labelled with its
  own "3/4" above it (`.neonMeta`), and the selected day is a small
  `.neonAccent` capsule under the weekday label rather than a sunken fill
  that swallowed a sunken bar. **Not done:** distinguishing a non-working day
  from a working day nobody planned — this read's `DayHistoryPoint` carries
  only `{dayKey, done, total}`, no `isWorkingDay`; adding it is a
  `src/lib/mobile/registry` change, and only the home/projects/chatlist
  agents may touch those files this round.
- **Flat KPI tiles (issue 13).** Rebuilt with `KPICard` directly: "Average
  progress" now carries a real `trend` (`.rising`/`.falling`/`.steady`
  against the previous period's own average — fetched for real via a second
  `fetchHomeAnalytics(period: previousPeriod)` call, never invented; `nil`
  until it answers, so no trend shows rather than a wrong one). "Below 90%"
  and "Deducted" (renamed from "Deductions applied", one line now) carry the
  captions and hues asked for. The "Team" tile is gone from the grid; its
  count now reads in the section's own subtitle ("4 people · September
  2026"). **Not done:** the six-month mini-bars — real bars would need five
  more `fetchHomeAnalytics` round trips just to draw a sparkline, which felt
  like the wrong trade for this pass; skipped rather than invented.
- **Ghosting under the collapsed title (issue 12).** All three screens now
  set `.toolbarBackground(.visible, for: .navigationBar)` +
  `.toolbarBackground(Color.neonBgSoft, …)`, so scrolled content has a solid
  bar over it instead of showing through. The stray top-of-page intro line
  is gone from Analytics outright (redundant with "Daily progress"/"Monthly
  progress" already saying what the cards are).

**Alerts**, renamed from "Activity" to "Alerts" (issue 16 — Home's own
"Unread alerts" row/wording is `AdminHomeView.swift`/`HomeDashboardCards.swift`,
outside this area's files, so only this half of the fix could be made here):
- **Broken bidi (issue 3).** `task-status.ts`'s one fixed English shape,
  `"<title>[ — <project>] moved from <From> to <To>."`, is now parsed back
  (`parseInsightsStateChange`) into the task's own title on its own `DirText`
  line and two `StateBadge`s joined by `arrow.forward` — no more a full
  English sentence laid out right-to-left around an Arabic name. Every other
  TASK_STATUS_CHANGED message (a daily report, a site visit, an automation
  rule) fails this parse on purpose and falls back to plain text, now capped
  at `.lineLimit(3)` (issue 11) rather than pushing the feed down eight lines.
- **"Finished a task" for a submission, forever "waiting" (issue 2).**
  TASK_SUBMITTED rows now read `L("%@ sent proof for review", employee.name)`
  — sending proof starts a check, it doesn't finish one — and the fixed "is
  waiting" sentence is gone entirely (only the task's own name is recovered
  from the message and shown). A trailing `BadgeView(L("Waiting for you"))`
  appears only when a second, best-effort `fetchHomeReviews()` confirms the
  entry is still actually in the queue. **Not done:** "Approved"/"Sent back"
  once decided — this screen has no way to tell those apart from here. The
  home/alerts payload has no submission outcome, and adding one is a
  `src/lib/mobile/home-reads.ts` change, which (like issue 14's gap above)
  is out of this area's files this round. Silence (no badge) rather than a
  guessed verdict once a submission is no longer pending.
- **Row anatomy (issue 10).** Padding is `NeonSpace.card` now, not `.sm`. The
  loose employee-colour corner dot is now a small `IconTile` badge (colour by
  destination state for a status change, per issue 11's own hue list — Done
  green, In review purple, In progress cyan, Pending grey — otherwise the
  per-type hue as before) sitting on a real `AvatarView` of the employee, not
  beside an unrelated icon tile. The trailing time is just "9:44 PM"
  (`shortTime`), and rows are grouped under `SectionLabel(Today/Yesterday/
  a date)`. Actionable rows (`parseAdminLink` resolves to something this app
  opens) get a `chevron.forward`.
- **A noisy, undifferentiated feed (issue 11).** Added a `PillFilterBar`
  (All · Needs you · Tasks · Reports) above the list, with a live count on
  "Needs you". **Not done:** collapsing consecutive same-task events into
  one row with an "Earlier: …" note. It's a materially bigger feature (it
  changes what a row even is), and the debug router's scroll anchors are
  defined against `data.alerts`' own index — reworking the list into merged
  rows and keeping "row-5" meaningful for the harness felt like the wrong
  thing to rush in the same pass as everything else here. The filter and
  destination-coloured tiles cover the "what needs the manager" complaint
  without it.

**Reviews:**
- **One hue everywhere (issue 15).** The empty state's tile is now
  `symbol: "star.fill", hue: .amber` — Home's own Reviews card, not an
  indigo checkmark.seal. Header shortened to one line, `L("Proof your team
  sent, waiting for your decision.")`; the approve/send-back rule moved into
  the empty state's own detail text, reworded off "finishes a task" onto
  "sends proof". **Not done:** the "Recently decided" section for a filled
  screen when the queue is empty. `homeReviews()` only ever returns pending
  submissions (`pendingSubmissions()`); a decided list needs a new server
  read, out of this area's files this round.

**Skipped outright, both explained in the issue list above:**
- Issue 17's "seed one pending submission for the debug router" — this
  session has no sign-in to the live studio and does no UI automation (see
  the task rules), so there is no way to create a real submission to seed;
  inventing one would be exactly the placeholder content the platform's own
  rules forbid. The `.ar` screenshots it also asks for are the
  orchestrator's re-screenshot pass, not this agent's.

## Open issues

- Clean build (`xcodegen generate` + the Debug/iphonesimulator build)
  succeeds after this round's changes too.
- Real gaps, all noted above rather than worked around with invented data:
  a submission's decided outcome isn't in the home/alerts payload; a day's
  `isWorkingDay` isn't in the analytics history read; there's no "recently
  decided" read for Reviews. All three are `src/lib/mobile/registry` changes
  outside this area's files this round.
- Live screenshots need real signed-in data — left for the orchestrator's
  pass, as instructed.
