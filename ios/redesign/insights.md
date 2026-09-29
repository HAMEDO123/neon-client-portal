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

## Open issues

- None known. Clean build (`xcodegen generate` + the Debug/iphonesimulator
  build) succeeds. All screens were read/reasoned through against
  `ios/Sources/Features/Home/FEATURES.md` line by line to confirm nothing
  built there was dropped.
- Live screenshots of `home-alerts` / `home-reviews` / `home-analytics`
  need real signed-in data (see FEATURES.md/AGENTS notes on not signing in
  to the live studio from this session) — left for the orchestrator's pass,
  as instructed.
