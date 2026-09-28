# The NEON design kit

Everything a screen is built from lives in `ios/Sources/UI/`. Use it rather
than hand-rolled paddings, colours and shadows, so every area looks and moves
as one product: the web's glass cards on the lavender page, ink buttons,
rounded display type, the cyan-purple-pink brand gradient.

**See it all at once:** in a Debug build, launch with `-neonKitGallery` to get
`NeonKitGallery` (`KitGallery.swift`), which shows every component with sample
content. Add `-neonKitSection Charts` to open at a section, and `-app_language ar`
to check it in Arabic. It also has SwiftUI previews in English and in RTL.

**Don't add another `README.md` under `ios/Sources`.** XcodeGen copies `.md`
files into the app as resources, and two files with one name stop the build
("Multiple commands produce …/README.md"). Name area notes `<Area>-NOTES.md`.

**Names are reserved.** Swift treats a `private struct StatTile` in your file as
a redeclaration of the kit's `StatTile`, so don't declare any type or global
function named like one below, even as `private`. Name your own helpers after
your area (`TaskBoardRow`, not `ListRow`).

---

## Rules of thumb

- A screen is `NeonScroll { … }` (or a `List` with `.neonListStyle()`), with
  `.refreshable`. Its blocks are `SectionHeader` + a `NeonCard`, a `CardList`,
  a `StatGrid` or a chart.
- A read's three states come from `LoadStateView`: skeleton, then `ErrorState`
  with the server's sentence and Retry, then content under `OfflineBanner`
  when it's a saved copy.
- Text somebody wrote goes through `DirText` (and `ListRow`, `HeroHeader`,
  `TimelineRow`, `PersonChip` do this for you). UI text goes through `L()`.
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
- iOS 16 is the target. The kit already guards what needs iOS 16.4 or 17.

---

## Tokens (`Tokens.swift`, `DesignSystem.swift`)

| Kind | Names |
|---|---|
| Brand colours | `Color.neonBg`, `.neonBgSoft`, `.neonInk`, `.neonCyan`/`Strong`, `.neonPurple`/`Strong`, `.neonPink`/`Strong`, `.neonOrange`/`Strong` |
| Meaning | `.neonSuccess`/`Strong`, `.neonDanger`/`Strong`, `.neonWarning`/`Strong`, `.neonInfo`/`Strong`. Put text in the *Strong* one and fills in the plain one. |
| Text | `.neonText`, `.neonTextSecondary`, `.neonTextTertiary`, `.neonTextFaint` |
| Surfaces, lines | `.neonSurface`, `.neonSurfaceStrong`, `.neonSurfaceSunken`, `.neonLine`, `.neonLineStrong` |
| Gradients | `LinearGradient.neonWordmark`, `.neonAmbient`, `.neonBrand`, `.neonInkHero`, `.neonGlass`, `.neonGlassStrong`, `.neonGlassEdge`, `.neonTint(color)` |
| Palette | `NeonPalette.color(at: i)` for series and categories. `NeonPalette.color(for: name)` gives a person a stable colour. |
| Spacing | `NeonSpace.xxs 2 · xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 24 · xxxl 32 · huge 48`, `.gutter 16` (screen margin), `.section 22` |
| Radii | `NeonRadius.xs 8 · sm 12 · md 16 · lg 20 (cards) · xl 24 · xxl 30 (heroes, sheets)` |
| Sizes | `NeonSize.touch 44 · field 50 · iconTile 38 · avatar 44` |
| Type | `Font.neonLargeTitle`, `.neonTitle`, `.neonTitle2`, `.neonTitle3` (rounded), `.neonHeadline`, `.neonBody`, `.neonCallout`, `.neonSubheadline`, `.neonFootnote`, `.neonCaption`, `.neonOverline`, `.neonNumber`, `.neonNumberSmall` (rounded, monospaced digits). All scale with Dynamic Type. |
| Elevation | `.neonShadow(.low / .card / .raised / .floating / .glow(color))` |
| Motion | `NeonMotion.snappy` (selection), `.bouncy` (arrivals), `.smooth` (layout), `.gentle`, `.quick`, `.fill` (numbers, rings). `NeonMotion.stagger(i)`. `withNeonAnimation(.snappy) { … }` |
| Transitions | `.transition(.neonPop / .neonRise / .neonSlideUp / .neonDrop)` |
| Numbers | `NeonFormat.number(v, decimals:)`, `.integer(n)`, `.money(v, decimals: 0)` ("JOD 1,250", as the web writes it), `.percent(0…100)`, `.compact(v)` (1.2K), `.parse(text)` (reads either digit set), `.dayKey(date)` → "YYYY-MM-DD", `.date(fromDayKey:)` |
| Haptics | `Haptic.tap()`, `.soft()`, `.selection()`, `.impact(.medium)`, `.success()`, `.warning()`, `.error()` |

---

## Surfaces and cards

```swift
// Any view on a surface. The padding is yours.
content.padding(16).neonSurface(.glass, radius: NeonRadius.lg)
// Surfaces: .glass (default), .strong, .solid, .sunken, .outline,
//           .tinted(color), .ink (white text), .brand (white text), .frosted (over photos)
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
IconTile("folder", tint: .neonPurpleStrong, size: 38, style: .soft)   // .soft / .filled / .glass
SectionHeader(L("Reviews"), subtitle: "…", count: 3)
SectionHeader(L("Projects"), actionTitle: L("See all")) { showAll() }
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
CountBadge(unread)                       // nothing at zero, "99+" above 99
statusTone("APPROVED")                   // one tone per platform status word; taskStateTone for task states
// BadgeTone: .cyan .purple .pink .orange .neutral .success .warning .danger .info (.background/.foreground/.color)

AvatarView(url: url, name: name, size: 44, ring: false, online: true)
AvatarStack(people.map { AvatarItem(id: $0.id, name: $0.name, url: $0.avatarURL) }, size: 28, limit: 4)
PersonChip(name: name, url: url, subtitle: L("Designer"), onRemove: { … })
RemoteImage(url: url, contentMode: .fill)  // fades in; branded shimmer while loading; fills its frame
    .frame(height: 180).clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
```

## Buttons

```swift
NeonButton(L("Save"), symbol: "checkmark") { await save() }        // .primary, large, full width
NeonButton(L("Hand out"), kind: .brand) { … }                         // the one hero action on a screen
NeonButton(L("Cancel"), kind: .secondary, size: .medium) { dismiss() }
NeonButton(L("Approve"), kind: .tinted(.neonSuccessStrong), size: .medium) { … }
NeonButton(L("Delete"), symbol: "trash", kind: .destructive,
           confirm: L("Delete this drawing?"), confirmMessage: L("The client stops seeing it.")) { await delete() }
NeonButton(L("Later"), kind: .ghost, size: .small) { … }
// sizes .small 34 / .medium 44 / .large 52; fullWidth defaults to true for .large.
// The spinner appears after 160 ms, so quick actions don't flicker. Taps are ignored while it runs.
// Pass isLoading: when the work is tracked elsewhere. Use .disabled(!isValid) to disable it.

Button(…) { … }.buttonStyle(.neon(.secondary, size: .medium))   // the same look for ShareLink, PhotosPicker, NavigationLink

IconButton("phone.fill", label: L("Call")) { … }                  // looks: .glass .filled .tinted .plain; badge: n
screen.floatingActionButton(label: L("New task")) { showNew = true }    // gradient + at bottom trailing
screen.floatingActionButton("plus", label: L("New"), title: L("New task"), isVisible: !isEmpty) { … }
```

## Filters, segments, search

```swift
FilterChips(selection: $filter, options: Filter.allCases, inset: 16,
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
           actionTitle: L("Plan the day"), action: { … })          // the symbol gently floats
ErrorState(message: error) { await load() }
OfflineBanner(savedAt: cachedAt)
SkeletonRows(count: 4)                      // ListRow-shaped placeholders with shimmer
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
- `neonAmbientBackground(animated: true)` makes the page's colour blobs drift.
  Use it on sign-in and heroes only. Lists keep them still.
- Kept from before, and unchanged in signature: `DirText(text, font:, color:, fill:, lineLimit:)`,
  `naturalDirection(text)`, `AccountMenu()`, `UploadMaker`, `CameraPicker`,
  `byteCount(n)`, `publishTone(state)`, `GlassCard`.
