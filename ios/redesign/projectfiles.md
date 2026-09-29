# projectfiles — redesign notes

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
