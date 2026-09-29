# The NEON design kit

Everything a screen is built from lives in `ios/Sources/UI/`. Use it rather
than hand-rolled paddings, colours and shadows, so every area looks and moves
as one product — the owner's mockups (Home and Chat): a lavender-to-white
page, white cards with large continuous corners, a hairline and a soft navy
haze; pastel icon tiles holding a vivid glyph; big bold SF Pro figures; cool
slate greys; blue, indigo and violet accents; capsule "View All ›" links;
round white header buttons; a sky-to-violet hero; a floating tab bar.

**See it:** a Debug build opens the gallery a screen at a time, no sign-in:
`xcrun simctl launch <device> com.neonjo.staff -neonScreen kit` (then `kit-2`
… `kit-12`; add `-app_language ar` for Arabic). 1–3 are Home, 4 is Chat, 5
figures, 6 controls, 7 rows, 8 states, 9 forms, 10 charts, 11 loading, 12
badges and every hue.

**Don't add another `README.md` under `ios/Sources`.** XcodeGen copies `.md`
files into the app as resources, and two files with one name stop the build
("Multiple commands produce …/README.md"). Name area notes `<Area>-NOTES.md`.

**Names are reserved.** Swift treats a `private struct StatTile` in your file as
a redeclaration of the kit's `StatTile`, so don't declare any type or global
function named like one below, even as `private`. Name your own helpers after
your area (`TaskBoardRow`, not `ListRow`).

---

## Rules of thumb

- A screen is `NeonScroll(spacing: NeonSpace.stack) { … }` (or a `List` with
  `.neonListStyle()`), with `.refreshable`. It already paints the page
  (`NeonAmbient`); never set a background colour of your own on a page.
- **A tab's root page has no navigation bar.** Hide it
  (`.toolbar(.hidden, for: .navigationBar)`) and put a `ScreenHeader` first in
  the scroll: the logo or a title on the leading side, round white
  `IconButton`s (`size: NeonSize.circleButton`) on the trailing side. Pushed
  detail pages keep the system bar and its back button.
- **Blocks are cards, and a card carries its own heading.** Use a
  `SectionCard` (icon tile, title, grey line, "View All ›") rather than a
  `SectionHeader` floating above a `NeonCard`. `SectionHeader` stays for a
  plain list (`CardList`, a run of `ListCardRow`s) where the rows are the cards.
- **Cards stack 12 pt apart** (`NeonSpace.stack`), inside a 16 pt gutter; tiles
  in a grid are 12 apart (8 when four to a row). Inside a card the padding is
  `NeonSpace.card` (16).
- **Which piece:** a headline number → `KPICard` in a `StatGrid` (four to a row
  with `density: .compact`, two otherwise); where things stand →
  `SegmentedProgress`; a list of people or conversations → `ListCardRow`s
  (one card each); rows inside a card → `ListRow` with `NeonDivider`s; shortcuts
  → `QuickActionGrid`; filters over a list → `PillFilterBar`; the top of Home →
  `HeroCard`; the top of a detail page → `HeroHeader`; the main "add" →
  `.floatingActionButton`.
- **Colour comes in families.** Pick a `NeonHue` (`.blue`, `.purple`,
  `.orange`, `.pink`, `.green`, `.cyan`, `.indigo`, `.amber`, `.red`, `.grey`)
  and pass it; the component draws the pastel tile, the deep glyph and the
  vivid bars from it. One hue per idea, the same on every screen (projects
  blue, published purple, approvals orange, updates pink, money green).
- A read's three states come from `LoadStateView`: skeleton (`SkeletonRows`,
  `SkeletonCard`, `SkeletonKPICard`), then `ErrorState` with the server's
  sentence and Retry, then content under `OfflineBanner` when it's a saved copy.
  Nothing to show is an `EmptyState` (`card: true` on a page of cards).
- Text somebody wrote goes through `DirText` (and `ListRow`, `ListCardRow`,
  `HeroHeader`, `HeroCard`, `StoryAvatar`, `TimelineRow`, `PersonChip` do this
  for you). UI text goes through `L()`, with its Arabic in the area's
  `ar.lproj/<Area>.strings`.
- **Right to left:** say leading and trailing, never left and right, and let
  stacks mirror. Symbols that point use the `.forward`/`.backward` names
  (`chevron.forward`). Anything drawn with a `Path` or a gradient's
  `UnitPoint`s does not mirror by itself: add
  `.flipsForRightToLeftLayoutDirection(true)` (the kit's charts, sparkline and
  hero already do). Never flip a photo. Check every screen with
  `-app_language ar`.
- **Dynamic Type:** use the kit's fonts (text styles), not `.system(size:)`.
  Where a row has no room to grow, cap it with `.dynamicTypeSize(...)` rather
  than letting it truncate; `StatGrid` already drops to two to a row for
  large text.
- Actions are `NeonButton { await … }`: it shows its own spinner. Anything
  that can't be undone gets `confirm:` (or `confirmDestructive`, or
  `destructiveSwipe` in a list). Report the outcome with `Toast`.
- Every sheet's content ends in `.neonSheet(…)`. This is required, not only
  for looks: a sheet does not inherit the app's language direction, and
  `.neonSheet` puts it back. A `.fullScreenCover` or `.popover` needs
  `.neonLanguage()`.
- Motion comes from `NeonMotion` and the modifiers in `Motion.swift`. They all
  respect Reduce Motion, so don't call `withAnimation(.spring(...))` with
  numbers of your own. Use `withNeonAnimation`.
- The app is light only (it forces `.light`). iOS 16 is the target; the kit
  already guards what needs iOS 16.4 or 17.

---

## Tokens (`Tokens.swift`, `DesignSystem.swift`)

| Kind | Names |
|---|---|
| Page | `Color.neonBg` (cool near-white), `.neonBgSoft` (the lavender at the top), `LinearGradient.neonPage`. `NeonAmbient` paints them with two soft glows; `NeonScroll` and `.neonListStyle()` put it behind you. |
| Brand colours | `.neonInk` (cool near-black), `.neonBlue`/`Strong`, `.neonIndigo`/`Strong`, `.neonPurple`/`Strong`, `.neonPink`/`Strong`, `.neonOrange`/`Strong`, `.neonAmber`/`Strong`, `.neonCyan`/`Strong`. `.neonAccent` is selection (a chosen pill, a pinned row, a link). |
| Meaning | `.neonSuccess`/`Strong`, `.neonDanger`/`Strong`, `.neonWarning`/`Strong`, `.neonInfo`/`Strong`. Put text in the *Strong* one and fills in the plain one. |
| Hues | `NeonHue.blue … .grey`: `.color` (bars, dots, filled tiles), `.deep` (glyph on the pastel, text), `.pastel` (tile), `.wash` (a whole tile or note), `.gradient` / `.fill`. `NeonHue(someKitColor)` finds a colour's family. |
| Text | `.neonText`, `.neonTextSecondary` (slate: labels, subtitles), `.neonTextTertiary` (times, meta), `.neonTextFaint` (chevrons, placeholders) |
| Surfaces, lines | `.neonSurface`, `.neonSurfaceStrong`, `.neonSurfaceSunken`, `.neonLine`, `.neonLineStrong`, `.neonShadowTint` (every shadow's navy) |
| Gradients | `LinearGradient.neonBrand` (sky → indigo → violet: hero, brand button), `.neonAccent` (selection, primary button), `.neonAction` (the floating button), `.neonWordmark`, `.neonAmbient`, `.neonInkHero`, `.neonGlass`, `.neonGlassStrong`, `.neonGlassEdge`, `.neonTint(color)`; `AngularGradient.neonStory` (story rings) |
| Palette | `NeonPalette.color(at: i)` / `.hue(at: i)` for series and categories. `NeonPalette.color(for: name)` / `.hue(for: name)` give a person a stable colour. |
| Spacing | `NeonSpace.xxs 2 · xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 24 · xxxl 32 · huge 48`, `.gutter 16` (screen margin), `.stack 12` (between cards), `.card 16` (inside a card), `.section 22` |
| Radii | `NeonRadius.xs 8 · sm 12 · md 16 (tiles in a card, fields) · lg 22 (cards) · xl 26 (hero, tab bar) · xxl 30 (sheets)`, `NeonRadius.tile(size)` for an icon tile |
| Sizes | `NeonSize.touch 44 · field 50 · iconTile 38 · iconTileLarge 40 · avatar 44 · circleButton 44 · fab 58` |
| Type (SF Pro) | `Font.neonLargeTitle`, `.neonTitle`, `.neonTitle2`, `.neonTitle3`, `.neonHeadline`, `.neonBody`, `.neonCallout`, `.neonSubheadline`, `.neonFootnote`, `.neonCaption`, `.neonOverline`, `.neonNumber`, `.neonNumberSmall`; for the mockups' pieces `.neonDisplay` (a hero's name), `.neonKPI` (a KPI figure), `.neonCardTitle`, `.neonRowTitle`, `.neonLabel` (under a figure), `.neonSubtitle` (under a card title), `.neonMeta` (times). All scale with Dynamic Type. |
| Elevation | `.neonShadow(.low / .card / .raised / .floating / .glow(color))` |
| Motion | `NeonMotion.snappy` (selection), `.bouncy` (arrivals), `.smooth` (layout), `.gentle`, `.quick`, `.fill` (numbers, rings). `NeonMotion.stagger(i)`. `withNeonAnimation(.snappy) { … }` |
| Transitions | `.transition(.neonPop / .neonRise / .neonSlideUp / .neonDrop)` |
| Numbers | `NeonFormat.number(v, decimals:)`, `.integer(n)`, `.money(v, decimals: 0)` ("JOD 1,250", as the web writes it), `.percent(0…100)`, `.compact(v)` (1.2K), `.parse(text)` (reads either digit set), `.dayKey(date)` → "YYYY-MM-DD", `.date(fromDayKey:)` |
| Haptics | `Haptic.tap()`, `.soft()`, `.selection()`, `.impact(.medium)`, `.success()`, `.warning()`, `.error()` |

---

## The page, top to bottom (the mockups' pieces)

```swift
NavigationStack {
    NeonScroll(spacing: NeonSpace.stack) {
        ScreenHeader.brand {                                   // or ScreenHeader(L("Chat"), leading: { … }) { … }
            IconButton("magnifyingglass", label: L("Search"), size: NeonSize.circleButton) { … }
            IconButton("bell", label: L("Alerts"), size: NeonSize.circleButton, dot: hasNew) { … }
            AccountMenu()
        }
        HeroCard(name, eyebrow: greeting, eyebrowSymbol: "sun.max.fill", subtitle: dateLine,
                 footnote: L("An overview of every client project delivery."),
                 photo: .url(coverURL), action: { … }) { weather }  // accessory at the top trailing corner
        StatGrid(columns: 4) {
            KPICard(L("Total Projects"), value: 4, symbol: "folder.fill", hue: .blue,
                    trend: .rising("+2", L("this month")), bars: history, density: .compact) { menuButtons }
        }
        SectionCard(L("Project Progress"), subtitle: L("Live status of all projects"),
                    symbol: "square.stack.3d.up.fill", hue: .blue, action: { … }) {
            SegmentedProgress([ProgressSegment(L("Planning"), value: 2, hue: .green), …])
        }
    }
    .toolbar(.hidden, for: .navigationBar)
}
```

| Piece | Use | File |
|---|---|---|
| `ScreenHeader(title, leading:, trailing:)`, `ScreenHeader.brand { … }` | A tab page's header instead of a nav bar. | Layout |
| `NeonLogo(size:)` | The gradient "N" and NEON, for a header. | Layout |
| `IconButton(symbol, label:, look:, size:, badge:, dot:)` | Round white button; `dot: true` for the red "something new". | Buttons |
| `IconButtonLabel(symbol, …)` | The same look as the label of a `Menu` / `NavigationLink`: `Menu { … } label: { IconButtonLabel("ellipsis") }`. | Buttons |
| `HeroCard(title, eyebrow:, eyebrowSymbol:, subtitle:, footnote:, photo: .url(u) / .image(i) / .none, action:) { accessory }` | Home's gradient greeting card; the photo melts in from the trailing side. | Hero |
| `KPICard(title, value:, format:, symbol:, hue:, caption:, trend:, bars:, density:) { menu }` | A headline figure with tile, ⋮ menu, trend and mini bars. `text:` for a figure that isn't a number. | Stats |
| `StatTrend.rising("+2", L("this month"))`, `.falling("−1", …)`, `.steady()` | The line under a figure; `.steady()` is "— No change" and makes a card's bars pale. | Stats |
| `TrendLabel(trend)` | That line on its own, anywhere. | Stats |
| `MiniBars(values, comparison:, labels:, hue:, muted:, height:)` | A few gradient bars; with `comparison` + `labels` it is the "This Month" chart. | Stats |
| `Sparkline(values, hue:, height:)` | A small smoothed line with an area and an end dot. | Stats |
| `SegmentedProgress(segments)` / `SegmentedProgressBar` / `ProgressLegend` | A whole split into coloured parts, with the dot legend under it. | Stats |
| `SectionCard(title, subtitle:, symbol:, hue:, tileStyle:, action:) { … }` | A card with its own heading; `actionTitle: L("Edit"), actionChevron: false` for a plain link; `trailing: { PillMenu … }` for any control. | Cards |
| `ViewAllButton(L("View All")) { … }` | The pale capsule link. | Cards |
| `PillMenu(L("Revenue")) { Button … }` | A white capsule that opens a menu. | Controls |
| `QuickActionGrid([QuickAction(L("New Project"), symbol: "plus", hue: .purple) { … }], columns: 3)` | Shortcut tiles; `columns: nil, inset: NeonSpace.card` is one sideways row inside a card (bleed it with `.padding(.horizontal, -NeonSpace.card)`). | Buttons |
| `ListRow(title, subtitle:, leading: .image(i) / .thumbnail(url:) / …) { Text(time); CheckCircle(done) }` | A task row inside a card, dividers between. | Cards, Controls |
| `CheckCircle(isDone)` | A task's tick: green disc or grey ring. | Controls |
| `StoryAvatar(name:, url:, ring: .unseen / .seen / .none, online:, showsAdd:)` | The stories row. | People |
| `OnlineDot(size:)` | "Here now", on anything. | People |
| `PillFilterBar(selection:, options:, title:, count:)` | Filters over a list in one white capsule; red counts; scrolls when it doesn't fit. | Controls |
| `ListCardRow(title, subtitle:, leading:, titleSymbol:, time:, count:, pinned:, muted:, badge:)` | A conversation / person / project on its own white card. | Layout |
| `anyRow.rowCard(pinned:, highlighted:)` | The same card for a row of your own. | Layout |
| `.floatingActionButton("square.and.pencil", label: …) { … }` | The round indigo-violet "add". | Buttons |
| `NeonTabBar(selection:, items: [NeonTabItem(tab, title:, symbol:, badge:, dot:)])` | The floating tab bar with the lavender pill, for a shell that draws its own. | TabBar |

`AvatarView(…, style: .solid)` draws white initials on the person's colour, as
the chat list does; `.soft` (the default) is the quiet pastel one.

---

## Surfaces and cards

```swift
// Any view on a surface. The padding is yours.
content.padding(16).neonSurface(.glass, radius: NeonRadius.lg)
// Surfaces: .glass (default: the mockups' white card), .strong, .solid, .sunken, .outline,
//           .tinted(color) (the hue's wash), .ink (white text), .brand (white text), .frosted (over photos)
content.glassCard(radius: 18)          // old name for .neonSurface(.glass)

NeonCard { … }                          // padded, full-width glass card, VStack(spacing: 12)
NeonCard(.tinted(.neonOrange), padding: 14) { … }

// A tappable card:
Button { open() } label: { NeonCard { … } }.buttonStyle(.pressableCard)
NavigationLink(value: route) { NeonCard { … } }.buttonStyle(.pressableCard)
```

`PressableStyle` / `.pressable` / `.pressableCard` give the springy press to any
tappable thing. `.neonContextShape(radius:)` makes a context menu's lifted
preview match a rounded card (`NeonCard` already has it).

## Screens and lists

```swift
NeonScroll {                          // ScrollView + LazyVStack + gutter + ambient page
    SectionHeader(L("Today"), count: tasks.count)
    CardList(tasks) { task in          // rows in one glass card, hairlines between
        NavigationLink(value: TaskRoute(id: task.id)) {
            ListRow(task.title, subtitle: task.project, leading: .icon("checklist"), chevron: true)
        }
        .buttonStyle(.pressableCard)
    }
}
.refreshable { await load() }
.navigationTitle(L("Tasks"))
```

- `NeonScroll(spacing: 16, padding: 16) { … }`: a lazy stack, so rows appear as
  they scroll in. Put `.refreshable` on it for pull to refresh.
- `CardList(data, id: \.id, dividerInset: 64) { row }`. `Identifiable` data can drop `id:`.
- **Swipe actions need a `List`:**
  ```swift
  List {
      ForEach(files) { file in
          ListRow(file.name, leading: .icon("doc"))
              .neonSurface(.solid, radius: 16)
              .neonListRow()                                   // no grey chrome, gutter insets
              .destructiveSwipe(L("Delete"), confirm: L("Delete this file?")) { Task { await delete(file) } }
              .swipeAction(L("Pin"), symbol: "pin.fill") { pin(file) }
              .contextMenu { … }
      }
  }
  .neonListStyle()                                             // plain, clear, ambient page
  ```
- `NeonDivider()` is a hairline.
- `LoadStateView(value:error:cachedAt:retry:) { value in … }` switches between
  a skeleton, `ErrorState` and the content, with `OfflineBanner` on a cached copy.
  Pass `placeholder: { … }` for a skeleton of your own.

## Rows and detail pieces

```swift
ListRow(title, subtitle: "…", meta: "Updated 2h ago",
        leading: .icon("doc.richtext", tint: .neonCyanStrong),   // or .avatar(url:name:online:), .thumbnail(url:), .plain
        value: "4.2 MB", badge: L("Late"), badgeTone: .danger, chevron: true)
ListRow(name, leading: .avatar(url: url, name: name)) { Toggle("", isOn: $on).labelsHidden() }  // custom trailing

KeyValueRow(L("Budget"), value: NeonFormat.money(48000), symbol: "banknote")
KeyValueRow(L("Client"), value: client, userText: true, selectable: true)
MetaLabel(L("Sep 30"), symbol: "calendar")               // a small symbol + a few words
IconTile("folder.fill", hue: .blue, size: 40, style: .soft)          // .soft (pastel) / .filled (gradient, white glyph) / .glass
IconTile("folder", tint: .neonPurpleStrong)                         // a kit colour is read as its hue
SectionHeader(L("Reviews"), subtitle: "…", count: 3)
SectionHeader(L("Projects"), actionTitle: L("View All")) { showAll() }     // the capsule link
SectionHeader(L("Files")) { IconButton("plus", label: L("Add")) { … } }
SectionLabel(L("Tomorrow"))                              // small uppercase label
DetailCard(title: L("Next step"), symbol: "arrow.forward") { DirText(next) }
StatusNote(symbol: "exclamationmark.triangle.fill", tone: .warning, title: …, detail: …)  // not dismissible
BulletList(lines: acceptance)                            // each line in its own direction
FlowRow { chips… }                                       // wraps onto the next line
```

## Heroes, timelines, stages

```swift
HeroHeader(project.name, subtitle: project.client, eyebrow: L("Project"),
           imageURL: resolvedMediaURL(project.cover)) {       // no image → the brand wash and a big icon
    HStack { StateBadge(state: "IN_PROGRESS"); BadgeView(text: L("Published"), tone: .success) }
}
// Pulling the page down zooms the photo.

TimelineRow(L("Concept approved"), subtitle: "…", time: "Sep 12", symbol: "checkmark", isFirst: true)
TimelineRow(L("Renders"), time: L("Now"), isCurrent: true)          // pulsing node
TimelineRow(isLast: true) { any content }

StageTrack(stages: projectStages.map { localizedEnum("stage", $0) }, current: index)
```

## Figures, progress, charts

```swift
StatGrid {                                         // two per row, equal heights
    // StatTile is the older name: it draws a KPICard (no menu, no bars) with its tint read as a hue.
    StatTile(L("Open tasks"), value: 42, symbol: "checklist", trend: StatTrend(text: "+6", tone: .success, up: true))
    StatTile(L("Payroll"), value: total, format: .money, symbol: "banknote", tint: .neonSuccessStrong)
    StatTile(L("On time"), value: 91, format: .percent, caption: L("last 30 days"))
    StatTile(L("Next"), text: "Sep 30", symbol: "calendar")     // a figure that isn't a number
}
// StatFormat: .integer, .decimal(n), .percent (0…100), .money, .moneyDecimals(n), .minutes, .custom { … }
CountingText(value: animatedValue, format: .integer)   // counts through every frame of an animation

ProgressRing(progress: 0.64)                           // 0…1, counts its percentage up
ProgressRing(progress: p, size: 44, lineWidth: 5, tint: .neonSuccess) { Image(systemName: "checkmark") }
ProgressBar(progress: 0.3, tint: .neonOrange, height: 8) // fills from the leading edge (right in Arabic)

ChartCard(L("Tasks finished"), subtitle: L("This week"), value: "38") {
    NeonBarChart(points, target: 8, targetLabel: L("Target"))    // [ChartPoint("Sun", 5), …]
}
NeonLineChart(points, color: .neonPurple, format: .percent)      // or series: [ChartSeries(…)]
NeonDonutChart(slices, size: 140, centerTitle: L("hours"))         // legend with values and shares
```

`ChartPoint(label, value, id:, tint:)`: give `id` when labels repeat. Charts
grow in when they appear, mirror in Arabic, and show "No data yet" when empty.

## Badges, states, people

```swift
StateBadge(state: task.state)            // the board's states in the studio's words; IN_PROGRESS pulses
StateBadge(L("Waiting"), tone: .orange, symbol: "hourglass")
BadgeView(text: L("High"), tone: .pink, symbol: "flame.fill")   // small uppercase label
CountBadge(unread)                       // red; nothing at zero, "99+" above 99. tone: .neutral for a plain count
statusTone("APPROVED")                   // one tone per platform status word; taskStateTone for task states
// BadgeTone: .cyan .purple .pink .orange .blue .neutral .success .warning .danger .info (.background/.foreground/.color/.hue)

AvatarView(url: url, name: name, size: 44, ring: false, online: true)          // style: .solid for the chat list
AvatarStack(people.map { AvatarItem(id: $0.id, name: $0.name, url: $0.avatarURL) }, size: 28, limit: 4)
PersonChip(name: name, url: url, subtitle: L("Designer"), onRemove: { … })
RemoteImage(url: url, contentMode: .fill)  // fades in; branded shimmer while loading; fills its frame
    .frame(height: 180).clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
```

## Buttons

```swift
NeonButton(L("Save"), symbol: "checkmark") { await save() }        // .primary (indigo), large, full width
NeonButton(L("Hand out"), kind: .brand) { … }                         // sky → violet: the one hero action on a screen
NeonButton(L("Cancel"), kind: .secondary, size: .medium) { dismiss() }
NeonButton(L("Approve"), kind: .tinted(.neonSuccessStrong), size: .medium) { … }
NeonButton(L("Delete"), symbol: "trash", kind: .destructive,
           confirm: L("Delete this drawing?"), confirmMessage: L("The client stops seeing it.")) { await delete() }
NeonButton(L("Later"), kind: .ghost, size: .small) { … }
// sizes .small 34 / .medium 44 / .large 52; fullWidth defaults to true for .large.
// The spinner appears after 160 ms, so quick actions don't flicker. Taps are ignored while it runs.
// Pass isLoading: when the work is tracked elsewhere. Use .disabled(!isValid) to disable it.

Button(…) { … }.buttonStyle(.neon(.secondary, size: .medium))   // the same look for ShareLink, PhotosPicker, NavigationLink

IconButton("phone.fill", label: L("Call")) { … }                  // looks: .glass (white disc) .filled .tinted .plain; badge: n, dot: true
screen.floatingActionButton(label: L("New task")) { showNew = true }    // gradient + at bottom trailing
screen.floatingActionButton("plus", label: L("New"), title: L("New task"), isVisible: !isEmpty) { … }
```

## Filters, segments, search

```swift
PillFilterBar(selection: $filter, options: Filter.allCases, title: { $0.label }, count: { counts[$0] })  // the list's main filter
FilterChips(selection: $filter, options: Filter.allCases, inset: 16,         // separate chips, selected in indigo
            title: { $0.label }, symbol: { $0.symbol }, count: { counts[$0] })
    .padding(.horizontal, -16)                       // bleed to the screen edges inside a padded stack
SegmentedPill(selection: $view, options: [.day, .week], title: { $0.label }, symbol: { _ in nil }, badge: { _ in nil })
Chip(L("Kitchen"), symbol: "fork.knife", isSelected: on, count: 4) { on.toggle() }

SearchField(text: $query, prompt: L("Search projects"))
let shown = projects.filter { matchesSearch(query, $0.name, $0.client) }   // ignores case, tashkeel, أ/إ/آ, ى/ي, ة/ه
"name".matchesSearch(query)
```

## Forms

```swift
SheetScaffold(L("New task"), subtitle: …, symbol: "checklist",
              primaryTitle: L("Hand out"), isPrimaryEnabled: isValid) {
    await save()                       // spinner while it runs; dismiss and Toast yourself on success
} content: {
    FormSection(L("Task"), footer: …) {
        NeonTextField(L("Title"), text: $title, prompt: …, symbol: "textformat", isRequired: true, error: titleError)
        NeonTextEditor(L("Details"), text: $details, minLines: 3, maxLines: 8, limit: 500)
        MoneyField(L("Budget"), amount: $budget)                  // Double or Double?, JOD, either digit set
        NumberField(L("Hours"), value: $hours, unit: L("h"))      // Double/Double?/Int/Int? bindings
        DateField(L("Due"), date: $due, components: [.date, .hourAndMinute], in: Date()...Date.distantFuture)
        TimeField(L("Starts"), time: $start)
        OptionalDateField(L("Reminder"), date: $reminder)         // "Add a date" until one is chosen
        MenuField(L("Priority"), selection: $priority, options: ["LOW", "MEDIUM", "HIGH"],
                  title: { localizedEnum("priority", $0) }, noneTitle: L("None"))
        SelectField(L("People"), selection: $ids, options: employees.map(\.id),     // Set<ID>: several
                    title: { name[$0] ?? "" }, avatar: { avatarURL[$0] })         // or Binding<ID?>: one
        ToggleRow(L("Tell them now"), detail: …, symbol: "bell.badge", isOn: $notify)
    }
}
.neonSheet([.medium, .large])       // on the sheet's content: grabber, radius, background, RTL
```

- `NeonTextField` also takes `keyboard:`, `contentType:`, `capitalization:`,
  `autocorrect:`, `isSecure:` (with a show/hide eye), `leftToRight:` (emails,
  links), `submitLabel:`, `onSubmit:` and `focus: $someBoolFocusState` to chain fields.
- `FormField(L("Label"), isRequired:, hint:, error:) { anyControl.fieldChrome(focused:error:) }`
  wraps a control of your own to match. `ValidationMessage(text)` goes under a field.
- `SheetHeader(title, subtitle:, symbol:) { onClose }` is the header alone, for a custom sheet.
- `.shake(attempts)` on a form: increment `attempts` when the server refuses.

## Feedback

```swift
Toast.success(L("Saved"))
Toast.error(error)                           // the error's own sentence: for a refusal, the server's
Toast.info(L("Copied"), detail: link)
Toast.warning(L("Nothing was sent"))
```

It drops in from the top, in its own window, so it shows above sheets and
never blocks touches around it. Tap or swipe it up to dismiss. Call it from
anywhere, including async code, with no `await`.

```swift
view.confirmDestructive(L("Delete this drawing?"), message: …, actionTitle: L("Delete"), isPresented: $asking) { … }
view.confirmDestructive(item: $fileToDelete, title: { L("Delete %@?", $0.name) }, actionTitle: L("Delete")) { file in … }

EmptyState(symbol: "tray", title: L("Nothing planned for today"), detail: hours,
           actionTitle: L("Plan the day"), action: { … }, hue: .indigo, card: true)   // a pastel tile that floats
ErrorState(message: error) { await load() }
OfflineBanner(savedAt: cachedAt)
SkeletonRows(count: 4)                      // ListCardRow-shaped placeholders with shimmer
SkeletonCard(lines: 3)                      // a SectionCard loading
SkeletonKPICard(compact: true)              // a KPICard loading
realRow.skeleton(isLoading)                 // redacts a view of the real shape and shimmers it
SkeletonBlock(width: 120, height: 12)       // build your own placeholder
anything.shimmer()
```

## Motion

```swift
row.staggered(index)                 // rows arriving one after another (capped at the tenth)
card.neonAppear(delay: 0.1)          // fade and rise on first appearance
symbol.neonFloat()                   // a slow bob
dot.neonPulse(isLive)                // something live
withNeonAnimation(.snappy) { selection = x }
.transition(.neonRise)
```

## Brand, sign-in and the rest

- `BrandMark(size: 80)` is the app icon on a glass tile with a slow halo.
  `NeonWordmark(size: 40)` is "NEON" in the web's shining gradient.
- `neonAmbientBackground(animated: true)` makes the page's glows drift.
  Use it on sign-in only. Everything else keeps them still.
- Kept from before, and unchanged in signature: `DirText(text, font:, color:, fill:, lineLimit:)`,
  `naturalDirection(text)`, `AccountMenu()`, `UploadMaker`, `CameraPicker`,
  `byteCount(n)`, `publishTone(state)`, `GlassCard`.

---

## What changed in the kit (for anyone migrating a screen)

Every existing component kept its API. These now look different everywhere:

- Page: `NeonAmbient` is the lavender-to-white page; cards (`.glass`) are near
  opaque white with a navy haze; `NeonRadius.lg` is 22.
- Type is SF Pro, not rounded; `neonInk` and the text greys are cool.
- `NeonButton(.primary)` is indigo (was ink); `.brand` is sky → violet.
- `StatTile` is drawn as a `KPICard` (its trend is a line under the label now).
- `IconTile(tint:)` draws the hue's pastel tile; `IconButton(.glass)` is a white
  disc (a dark frosted one when the glyph is white, as on a call).
- `CountBadge` defaults to red; `Chip` and `FilterChips` select in indigo.
- `SectionHeader`'s action is the "View All ›" capsule.
- `EmptyState` has a pastel tile; `StatusNote` a wash of its tone;
  `SkeletonRows` are row cards.
- `neonOrange` is orange (#F97316); the old amber is `neonAmber`.
