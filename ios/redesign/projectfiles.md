# projectfiles — redesign notes

## Round 2 — critic pass on live screenshots

Every screen kept its features, its server calls and its guard rails; this
round changed the polish layer the critic actually judged.

**Drawings** (highest-impact fix): the row used to spend its trailing slot on
a repeated, uppercase "ARCHITECTURAL" badge plus three bare 15pt glyphs,
leaving about 45pt for the title — which is what hyphenated "wateen" into
"wa-/teen". The category moved out of the row entirely: the list now groups
under `SectionLabel(L(category))` headers, with a `FilterChips` row (only
when more than one category is actually present in the data — on this
project's 7 all-Architectural drawings, it doesn't show at all, which is the
right call, not a bug). The three trailing icons became one `Menu` behind a
44pt `IconButtonLabel("ellipsis")`: Open file, Revision history, Upload new
revision, Delete. Each row is `ListRow(...).rowCard()` (was a `ListRow`
double-padded inside its own `.padding(10)` glass surface), gets a real photo
`.thumbnail` for jpg/png/heic files (icon only for PDF/DWG), and the
expanded revision history is its own `DetailCard` under the row rather than
a hand-padded `VStack`. The title is capped at `.dynamicTypeSize(...(.xxLarge))`
so it can't hyphenate again at an accessibility text size.

**Every section's header** is now the same `SectionCard` pattern Gallery
already uses — an `IconTile` in the section's hue, the title, a subtitle
built from the real counts already on screen ("7 drawings · 0 revised",
"5 lines · JOD 12,400", "2 waiting on the client" for approvals still asked,
open/comment counts, …) — instead of a floating `SectionHeader` with a round
"+". That "+" is now hidden while the list is empty (`showAdd` = "at least
one row"), so an empty tab offers exactly one way in: the `EmptyState`'s own
capsule. Comments keeps a custom trailing action instead of "Add": a
`square.and.pencil` "Write to the client" button, itself hidden while the
thread is empty for the same reason (issue 3 — a reply arrow on nothing to
reply to, hard-coded `.left` regardless of layout direction).

**One symbol and hue per section, defined once** (`PFSection` in
`ProjectFilesShared.swift`) and read by the empty state, every row's leading
icon and every sheet's header icon: Drawings `pencil.and.ruler`/cyan,
Documents `doc.text`/purple, BOQ `list.number`/**amber** (was orange, which
collided with Approvals — the kit's own example reserves orange for
approvals), Pricing `banknote`/green, Materials `square.stack.3d.up`/pink,
Furniture `sofa`/indigo, Approvals `checkmark.seal`/orange, Comments
`bubble.left.and.bubble.right`/blue. The symbols match the immutable ones
`ProjectDetailView.DetailSection.symbol` already draws on that tab's chip
(Projects area, not touched) rather than asking that file to change. A money
total (BOQ's subtotal, Pricing's total) still draws in green regardless of
its section's hue — "money green" per the kit's own rule of thumb.

**Arabic.** Every `MenuField` category list now reads `title: { L($0) }`
instead of the raw English server value, `BadgeView` category badges route
through `L()`, and every example placeholder that was a bare string literal
now goes through `L()` too. ~30 category words (Architectural, Flooring,
Marble, Interior Works, …) and every new UI string got an `ar.lproj`
translation. `"%d line items"` also got a real `ProjectFiles.stringsdict`
(Arabic zero/one/two/few/many/other) so 3–10 reads "بنود" and 11–99 reads
"بندًا" instead of the flat "بند" every count used to get — verified against
the actual compiled bundle with a throwaway `swiftc` harness (no simulator,
no server) before landing it, since this codebase had never used a
stringsdict before. See "Known limits" below for what this doesn't cover.

**Pricing's note** used to send people to "the project's Overview" to
"enable Show Execution Pricing" — Overview only has a read-only visibility
row; the switch is in Edit. It's shortened to "Hidden from the client" and
now carries its own `NeonButton("Show to Client")`, which reads the
project's other five visibility flags first and writes all six back with
`showPricing: true` (`updateProjectSettings` replaces the whole record —
sending only one flag would have silently cleared the other five; caught
this by reading `project-actions.ts` before wiring the button, not by
guessing). It also only shows once there's a list to be a note above
(`!items.isEmpty`), so an empty Pricing tab isn't two stacked "nothing here"
cards.

**BOQ's "Related drawing"/"Related space"** are now `MenuField`s over the
project's own drawings and spaces (fetched in the add sheet) instead of free
text — a typo in "A-102" used to quietly break the link to a drawing already
on file.

**The revision sheet** prefills the next label from the drawing's own
revision (`nextRevisionLabel`: "R00" → "R01") instead of a hard-coded "R03"
that could suggest skipping two revisions the drawing was never on. The
field's hint says "Now on R00"; "What changed" got a real example instead of
echoing its own label.

**Comments' "Mark Resolved"** is relabelled "Mark as Addressed", and the
result reads "Addressed · waiting on the client" in info tone rather than
success-green "Resolved" — the studio can close its own side of a client's
change request, but nothing here is the client's own sign-off, so it
shouldn't read like one. (The server's `Comment` model has no
`resolvedBy`/`resolvedAt` columns, so "who marked it and when" — part of the
critic's suggested fix — isn't shown; adding those would be new schema, and
Comments isn't one of the areas this pass is allowed to add server fields
for. Noted below, not invented.)

**Approvals'** unanswered state is `L("Waiting for the client")` in `.info`
tone instead of "Pending Review" in warning amber — asked and not yet
answered is not a problem to flag amber, and it shouldn't read as though
somebody is actively reviewing it.

**Touch targets and red noise.** Every bare trailing delete glyph
(Documents, BOQ, Pricing, Approvals, Comments) is now
`IconButton("trash", look: .plain, tint: .neonDangerStrong, size: NeonSize.touch)`
— a real 44pt target instead of a ~22pt one, and the kit's danger colour
instead of system `.red`. Drawings' delete moved into the row's `Menu`
instead, so there's no separate trash glyph on that list at all.

**Add-sheet forms.** BOQ, Furniture and Materials — the three with ten-plus
ungrouped fields — are now split into titled `FormSection`s (Item; Quantity
& Price; Where It Goes; Details, or the equivalent for each). Five fields
that echoed their own label as a placeholder (Brand/Brand, Model/Model,
Color, Finish, Supplier) now show no placeholder rather than a fake example.
"(optional)" is gone from field labels that already carry a required-field
asterisk on the fields that need one. Pricing's "Label" placeholder no
longer repeats the category picker directly above it — it's a real example
("e.g. Kitchen joinery") instead.

**Casing.** Every add sheet's header, its `EmptyState` capsule and its
primary button now agree on Title Case ("Add Drawing" everywhere, not "Add
drawing" / "Add Drawing" split across the same sheet).

**Fonts.** Hand-rolled `.system(size: 11/12/12.5/14/14.5/15)` sizes in
Drawings, Comments, Materials and Furniture are now the kit's own text
styles (`.neonRowTitle`, `.neonSubtitle`, `.neonMeta`, `.neonNumberSmall`),
including dropping the `.rounded` design on a materials/furniture price.
`ImagePickerField` (BOQ, Materials, Furniture) now wraps its control in
`FormField` instead of drawing its own 13pt-medium label, so it matches
every other field's label weight.

### Known limits — flagged, not silently dropped

- **English pluralization is out of reach from this area.** `L()`
  (`Sources/Core/Localization.swift`) returns the raw key verbatim for
  English and never consults a bundle at all, so an English `.stringsdict`
  would never be read — "1 line items" is still what English shows.
  Fixing that needs the shared localization pipeline itself, which is
  outside `ios/Sources/Features/ProjectFiles/`. The Arabic side is properly
  fixed and was verified against the compiled bundle (see above).
- **`ios/Sources/UI/` (the kit) is the only thing I can't touch, and two
  sub-asks needed it:**
  - Issue 12's action-bar band and disabled-button contrast live in
    `SheetScaffold`'s own `safeAreaInset` and `NeonButtonStyle`
    (`Feedback.swift` / `Buttons.swift`) — the material band and the
    disabled 42%-opacity rule are drawn once, for every sheet in the app, by
    the kit. Skipped rather than forking a second, area-local sheet
    scaffold that every other area's sheets wouldn't share.
  - Issue 15's per-section header tile colour needs `SheetScaffold`/
    `SheetHeader` to take a `hue`/`tint` they don't expose today (they
    always draw `.neonPurpleStrong`). The rest of issue 15 — matching
    casing across a sheet's header, capsule and button — is fixed; the
    colour can't be without that kit change.
- **BOQ's chip and Approvals' hue collision** was fixed on this area's side
  (BOQ moved to amber everywhere it draws its own icon/empty state/
  subtotal). The chip itself (`pencil.and.ruler`, `list.number`, … on each
  tab's pill) is drawn by `ProjectDetailView.DetailSection.symbol` in the
  Projects area, out of this area's files — this pass's symbols were chosen
  to *agree* with what that file already draws, not to change it.


Area: every project-file tab embedded by the Projects area's
`ProjectDetailView` (their file, not touched here) — drawings, documents,
BOQ, pricing, materials, furniture, approvals, comments. All eight already
used the design kit's own components (`SectionHeader`, `CardList`,
`ListRow`, `EmptyState`, `LoadStateView`, `SheetScaffold`, …), so most of the
mockups' visual language (lavender-to-white page, glass cards, pastel icon
tiles, capsule links, SF Pro figures) arrived automatically once the kit
itself was upgraded — nothing in this area hand-rolled a colour, radius or
shadow before, and still doesn't. What changed here is the polish layer on
top: a consistent hue per section, motion, and two clearer totals.

## What changed, per screen

- **Drawings** (`pf-drawings`, add sheet `pf-drawings-add`, revision sheet
  `pf-drawings-revision`): cyan empty state; each drawing card now arrives
  staggered (`.staggered(index)`). Everything else — category, sub-category,
  revision history expand/collapse, upload/remove a revision, delete a
  drawing — unchanged.
- **Documents** (`pf-documents`, `pf-documents-add`): purple empty state;
  the card list itself now has an appear transition.
- **BOQ** (`pf-boq`, `pf-boq-add`): orange empty state. Added a **Priced
  Items Subtotal** card under the list — the one new thing in this pass.
  The web admin BOQ tab has no total at all (only the client page sums it,
  gated by `showBoqQuantities`/`showBoqPrices` — a client-page concern, per
  FEATURES.md). Rather than inventing a number, this sums only the lines
  that actually carry a unit price, and says so in the caption ("Only items
  with a unit price are counted."), so a project with partial pricing never
  reads as a completed estimate. It appears only when at least one line has
  a price. Flagged under kitRequests/openIssues in case the reviewer would
  rather this parity gap with the web stays as it was.
- **Pricing** (`pf-pricing`, `pf-pricing-add`): green empty state. The
  existing "Total Project Cost" row (already the same sum the web computes —
  every non-optional line) is now a proper hero-weight total: icon tile,
  a line-item count under the label, the figure in `.neonNumber`. No change
  to what is summed or when it's shown (still behind `showPricing`, still
  the "hidden from client" notice when off).
- **Materials** (`pf-materials`, `pf-materials-add`): pink empty state
  (matches the existing pink category badge); grid cards now arrive
  staggered and their context-menu preview matches the card's own corner
  radius (`.neonContextShape`).
- **Furniture** (`pf-furniture`, `pf-furniture-add`): indigo empty state;
  same stagger + context-shape treatment as Materials.
- **Approvals** (`pf-approvals`, `pf-approvals-add`): orange empty state
  (the kit's own example: "approvals orange"); list appear transition.
- **Comments** (`pf-comments`): blue empty state; each comment card arrives
  staggered. Reply-as-studio panel, resolve/reopen, delete — unchanged.

## Deliberately kept as-is

- **Add-only, no edit sheets.** None of these eight tabs has an edit action
  on the web or in `ProjectFilesAPI.swift` — only create and delete. Adding
  editing would be new product behaviour, not a redesign, and there is no
  server action to call. Left out on purpose.
- **Delete stays a trailing trash button + confirm, not `List` swipe
  actions.** This was already the pattern on every one of these eight
  screens before this pass (and is what "keep what works" means here); the
  kit's `.destructiveSwipe` needs a `List`, and switching every row's
  container for a small motion win risked more than it was worth in the
  parallel-build window.
- **BOQ's subtotal is additive, not a restatement of the client's total.**
  It's computed client-side from real, already-loaded rows — no new read.

## Router ids (screenshot with `-neonScreen <id>`)

Every screen is opened on the studio's first real project (`DebugAsync` →
`fetchProjectsList().value.projects.first`), wrapped in a `NeonScroll` the
way `ProjectDetailView` actually hosts each section (the section itself
carries no page chrome). An "Add" sheet is pushed as its own screen, per the
brief's "a sheet can be shown as a screen":

`pf-drawings`, `pf-drawings-add`, `pf-drawings-revision` (needs the
project's first drawing too, so it chains two reads), `pf-documents`,
`pf-documents-add`, `pf-boq`, `pf-boq-add`, `pf-pricing`, `pf-pricing-add`,
`pf-materials`, `pf-materials-add`, `pf-furniture`, `pf-furniture-add`,
`pf-approvals`, `pf-approvals-add`, `pf-comments`.

No `.id("anchor")`/`.debugScroll` anchors added: none of these eight run
long enough on real studio data to need a second screenshot below the fold
(the longest, Drawings/Materials/Furniture grids, fit a scroll or two at
most) — the router already reaches every state without one.

## Strings

New keys added to `ios/Resources/ar.lproj/ProjectFiles.strings` (table
already existed, complete for everything before this pass): `"%d line
items"`, `"Priced Items Subtotal"`, `"Only items with a unit price are
counted."`. Everything else routes through existing `L()` keys.

## Open issues / kitRequests

- **BOQ subtotal parity.** See above — added deliberately, but it's new
  scope beyond "redesign the existing screen." If the studio doesn't want a
  BOQ total on the admin/team side at all (matching the web exactly), this
  card is the one thing to strip back out; it's self-contained (one `if`
  block).
- **No kit gap found.** Every piece needed (`EmptyState` hue/card,
  `IconTile`, `.neonSurface(.tinted(_))`, `.neonNumber`, `.staggered`,
  `.neonContextShape`, `.neonAppear`) already existed in the upgraded kit.
  Nothing area-local had to be built.
- **A build trap worth flagging to other agents:** combining `EmptyState`'s
  named `hue:`/`card:` parameters with an *unlabeled* trailing closure for
  `action` doesn't compile — `action` is declared before `hue`/`card`, and
  Swift's trailing-closure rule requires the parenthesized arguments to stop
  at the parameter the trailing closure fills. It surfaces as a bizarre,
  wrongly-located diagnostic several lines away ("value of optional type …
  must be unwrapped"), because the type checker can't fully solve the
  surrounding `LoadStateView` closure and blames an unrelated line, plus
  which of the pattern's several call sites the compiler complains about is
  nondeterministic between one incremental build and the next — genuinely
  cost real time to trace back to the one true cause. The fix is
  `action: { … }` as a named argument ahead of `hue:`/`card:`, no trailing
  closure. Anyone else adding `hue:`/`card:` to an existing `EmptyState(...)
  { action }` call will hit the same thing.
