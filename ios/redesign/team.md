# Team area — redesign notes

Branch `ux-team` off `ux-base2`, worktree `/Users/hamedsamir/neon-wt/ux-team`.
The area's code was already built on the kit (`NeonScroll`, `LoadStateView`,
`CardList`, `ListRow`, `StatGrid`/`StatTile`, `NeonButton`, `SheetScaffold`,
`FormSection`, …) from an earlier pass, and the design-system agent's token
upgrade already recoloured every one of those components in place. This pass
is the polish the README asks for on top of that: fixing the one anti-pattern
the kit calls out by name (`SectionHeader` floating above a bare `NeonCard`
instead of `SectionCard`), the specific "wall of text" complaint on the
playbook, avatars in the header, a KPI row on the employees list, and wiring
every screen and sheet into the debug router with scroll anchors.

## Screens and sheets covered (router ids)

| id | View | Notes |
|---|---|---|
| `team-employees` | `EmployeesRootView` | Pushed from More, keeps the system nav bar (per the kit rule: only a tab's *root* loses it). |
| `team-employee` | `EmployeeDetailView` | Anchors `profile`, `day-plan`, `sales`, `performance`, `warnings`, `access`, `playbook`. |
| `team-payroll` | `PayrollRootView` | Anchors `totals`, `paysheet`, `attendance`, `receipts` (no `salaries` any more — that section was removed in the design-critique pass below). |
| `team-employee-create` | `CreateEmployeeSheet` | Was `private`; opened directly as a screen now (its `.neonSheet` detents are no-ops outside a real sheet, harmless). |
| `team-employee-edit` | `EditEmployeeSheet` | `DebugAsync` → first employee's id → `DebugAsync` → their full record. |
| `team-employee-password` | `ResetPasswordSheet` | `DebugAsync` → first employee's id. |
| `team-payroll-pay` | `EditPaySheet` | `DebugAsync` → first payroll row's employee info. |
| `team-payroll-attendance` | `RecordAttendanceSheet` | `DebugAsync` → the payroll response's employee list. |
| `team-payroll-receipt` | `CorrectReceiptSheet` | `DebugAsync` → first receipt this period (may be empty — no crash, `DebugAsync` shows "nothing to open this with"). |

`CreateEmployeeSheet`, `EditPaySheet`, `RecordAttendanceSheet` and
`CorrectReceiptSheet` were `private` to their files; made `internal` (a
one-line access change, nothing about their behaviour) so `TeamScreens.swift`
can open them for screenshots — the same visibility every other sheet in this
area already had.

## What changed

- **Employees list** (`EmployeesRootView`): a `StatGrid` of four `KPICard`s
  above the search field — Team, Active, Warnings, No account — all counted
  client-side off the same response the list already has, nothing invented.
  Gives the list the KPI-row presence the mockups put on every screen, where
  before it had only the plain "Team 5" count next to the add button (kept).
- **Employee detail** (`EmployeeDetailView`):
  - Header gets an `AvatarView(style: .solid)` next to the name — the same
    per-name hue every other avatar in the app already carries.
  - **"What they usually do" no longer runs as a wall of text.** The server
    hands over one string the manager typed free-form — often several
    paragraphs with a dashed list run straight into them — and the old code
    drew it as a single `DirText`, so a long Arabic playbook read as one
    unbroken block with the "-" list markers sitting inline. A new
    `TeamPlaybookText` (private to this file) splits it into paragraphs and
    groups consecutive "-"/"•" lines into a `BulletList`, so the manager's
    own words come back readable instead of reformatted or shortened. Empty
    lines only end a run; they don't become their own blank paragraph.
  - Sales / Performance / Account access, plus `TeamWarningsCard`, moved
    from `NeonCard { SectionHeader(...); … }` to `SectionCard(...)`
    (icon tile, title, grey line) — the exact swap the kit's README calls
    out under "What changed in the kit": *"a card carries its own
    heading... `SectionCard`... rather than a `SectionHeader` floating above
    a `NeonCard`."* The warnings card's dot row (n/limit) is now the
    `SectionCard`'s `trailing:` slot instead of being laid out by hand next
    to a bare `SectionHeader`.
  - Every performance figure still refuses below its minimum sample and
    prints the server's reason (`indicator.why`) — untouched.
  - Wrapped in `ScrollViewReader` with `.id()` on each section and
    `.debugScroll(proxy)` (guarded `#if DEBUG`, since that modifier only
    exists in Debug builds) for `-neonScroll <anchor>`.
- **Day plan card** (`DayPlanCard`): the same `NeonCard`+`SectionHeader` → `SectionCard`
  swap for its header ("Plan {name}'s day"). Tick-and-time editing, the
  generate/save/put flow, and the note that block reordering/adding isn't
  possible from here (a server-side limit, not a missed screen — see
  `FEATURES.md`) are unchanged.
- **Payroll** (`PayrollRootView`):
  - `DeviceIdsCard` (fingerprint pairing) gets a `SectionCard` heading
    ("Fingerprint pairing") instead of a plain caption line above a bare
    `NeonCard` — same swap, same reasoning.
  - Wrapped in `ScrollViewReader` with anchors for `-neonScroll`.
  - Totals (`StatTile`/`KPICard`), the pay-sheet cards, salaries list,
    attendance list and receipts list matched the kit's patterns at the time
    (`SectionHeader` above a run of cards/`CardList` is the *allowed* case,
    not the anti-pattern). The design-critique pass below later removed the
    separate salaries list and reworked the pay-sheet cards themselves.
- **Strings:** one new key, `"Fingerprint pairing"`, added to
  `ar.lproj/Team.strings` with an Arabic translation. Every other string
  touched was already in the table.

## Deliberately kept unchanged

- All existing actions, confirms and refusals: disable/enable account
  (confirm), revoke login (confirm), give/remove a warning (confirm, final-
  warning wording), the day-plan generate/save/put flow and its "cannot
  reorder or hand-add a block" limit, salary edit, attendance record/delete,
  device-id pairing, receipt correction.
- The performance card's sample-size refusal and its stated reason — never a
  guessed or presence-based figure.
- Payroll's arithmetic and every figure on it — untouched, server-computed.
- `EmployeeFormsView.swift` (Edit details / Reset password sheets) — already
  built entirely from kit form components (`FormSection`, `NeonTextField`,
  `ToggleRow`, `MenuField`, `NumberField`); nothing there matched the
  `NeonCard`+`SectionHeader` anti-pattern or needed a readability fix, so it
  was left as-is rather than changed for its own sake.

## Open issues / kit requests

- None. The kit had everything this pass needed (`SectionCard`'s `trailing:`
  slot for the warnings dots, `BulletList` for the playbook, `AvatarView`
  for the header). No area-local component was needed.
- Not re-litigated here (already reported in `FEATURES.md`, unchanged by
  this pass): day-plan block reordering/hand-adding needs a change to the
  shared server action `saveDayPlanEdits`, out of this area's files.

## Build

`xcodegen generate -q` then the Debug/iphonesimulator build in this
worktree: **BUILD SUCCEEDED**, no new warnings introduced beyond an
`unused proxy` note in Release-only compilation paths (the `ScrollViewReader`
proxy is only read inside `#if DEBUG`, which is expected and harmless).

---

## Design-critique pass (23 issues, `team-critique.json`)

A second pass, against a critic's screenshot review of the above
(`ux-shots/round1/team-*`, judged against `team-critique.json`). One agent
did most of this pass (committed as `08846b1`) and stalled before writing it
up; this note also covers the small amount finished afterwards.

**All 23 issues were addressed.** 22 are genuine code fixes; the 23rd (the
Employees/Payroll team-count mismatch) could only be partly fixed from these
files, for a reason explained below, so its fix is an honest on-screen
caption rather than the two screens agreeing outright.

### The five money/trust bugs (high severity)

1. **A weekly wage read as a monthly one.** `PayrollRow` (`PayrollRootView.swift`)
   now shows a `Weekly` badge next to the name when `payBasis == "WEEKLY"`,
   and a `MetaLabel` states the base salary and its basis
   (`"%@ · %@"`, e.g. "JOD 300.00 · Weekly"). `Total payable`'s caption adds
   `"includes %d weekly"` whenever any row is weekly, so the combined figure
   is never silently mixing two different pay periods.
2. **"Final pay JOD 0.00" for nobody's salary.** `PayrollRow` checks
   `employee.salaryAmount == nil` first: with no salary set it draws no
   breakdown at all, only a `BadgeView("No salary set")`, a `StatusNote`
   that names the uncharged late hours if there are any, and a
   `NeonButton("Set salary")` that opens `EditPaySheet` directly.
3. **A made-up "3:00 AM".** `formattedDay` (`Core/Formatting.swift`, a
   shared file outside this area, already fixed before this note) parses the
   day and formats it with `time: .omitted` in the UTC timezone the
   `@db.Date` column is actually stored in — the day is shown, never a
   clock-face time invented by converting UTC midnight into Amman's. Both
   attendance rows and the "View All" sheet's day headings use it.
4. **Team counts disagree (Employees 5, Payroll 4).** Fixed after this pass
   by the orchestrator: `team/employees` now also sends `accessRole`, the
   Employees KPIs count only the team (as Payroll does), and the manager's
   own device-pairing row carries a "You · manager" badge instead of being
   counted. The interim footnote explaining the difference is gone. (The
   smaller device-count mismatch — dead subscriptions counted on Employees —
   is still a server aggregate that doesn't filter on `active`.)

5. **A delay sheet pre-filled with a chargeable hour.** `RecordAttendanceSheet`
   starts `delayHours` at `nil` (was `1`), the `NumberField` takes whole
   hours only (`decimals: 0`, matching the studio's round-up rule), the
   `DateField`'s range is `Date.distantPast...Date()` so no future day can
   be picked, and `isPrimaryEnabled` requires both an employee and
   `delayHours ?? 0 > 0` — so nothing can be charged by one accidental tap.

### Everything else (medium/low severity)

All fixed, matching the critique's suggested fix in each case unless noted:

- Manager-voice adjustment rows (`AdjustmentRow` parses the "N of M tasks
  (P%)" shape back out of the server's employee-facing sentence and redraws
  it in the studio's own words; a reason of a different shape still shows
  honestly, unparsed, rather than being invented).
- `Total payable` full-width and green, `StatGrid(columns: 3)` at
  `.compact` density for Team/Deducted/Receipts so no figure is drawn larger
  just because it's shorter.
- Pay-sheet rows rebuilt on `ListRow` with an avatar, `%@/h`-formatted
  rates, whole-hour lateness, and a receipts `MetaLabel` shown only when
  `receiptTotal > 0`.
- The separate "Salaries" list is gone; each pay-sheet card is itself the
  editor now (`Button(action: onEdit) { ListRow(...) }`).
- Fingerprint pairing collapsed behind "View All", a `Paired` badge per row,
  and `Save` appearing only once a typed number actually differs from the
  saved one.
- Attendance: the card shows the 5 most recent non-zero delays with a
  44pt `IconButton` trash target; the full month (including zero-hour
  reader tests) is a day-grouped "View All" sheet with swipe-to-remove.
  The same 44pt `IconButton` swap was applied to `TeamWarningsCard`'s trash
  button.
- The playbook moved out of the header into its own collapsed
  `SectionCard`, and `TeamPlaybookText` now strips bidi marks (U+200E/F,
  U+061C) before checking for a bullet prefix, and recognises "–", "—" and
  "•" as well as "-".
- `EmployeeDetailView`'s header is a `HeroHeader` with the role as its
  subtitle, an "Employee" eyebrow, and `MetaLabel`s for the added date
  (date-only) and a relative "signed in" time, instead of three-line full
  timestamps.
- The sales card formats its own month on the device
  (`teamMonthYearLabel`, reading the raw `"YYYY-MM"` key rather than the
  server's English `Intl` string) and shows an actual "0/3 projects sold"
  figure instead of an empty bar.
- The performance card is `KPICard`s in a `StatGrid`, with the refused
  indicators grouped into one block below rather than left as isolated
  half-empty tiles.
- The day-plan segmented control lists `[today, tomorrow]` in reading
  order (tomorrow stays selected by default), and "Generate" is the one
  `.brand` action on the card.
- Account access is three stacked full-width buttons (secondary → tinted
  danger → destructive, easiest-to-undo first) instead of an uneven 2+1
  grid, and both push counts go through `teamPlural` for a real
  singular/plural instead of "1 device", "400 notification sent".
- The Employees list says "Team" once (the KPI), adds via
  `.floatingActionButton`, and shows only exception badges
  (`Disabled`/`No login`/warnings) instead of `ACTIVE` and `0/3 SOLD` noise
  on every row; devices use the `iphone` symbol and `teamPlural`.
- Arabic fixes: the playbook heading uses the correct singular ("مهامه
  المعتادة", not a plural "they"); every counted phrase the critique named
  ("%d device", "%d/%d sold", "%d notification sent") has a real
  singular/plural pair in `Team.strings` rather than one fixed form (there
  is no true zero/one/two/few/many/other plural pipeline in this app — see
  `TeamModels.swift`'s `teamPlural` doc comment — so this is a
  singular-vs-plural improvement, not a full `.stringsdict`); the payroll
  and sales period labels are formatted on the device in the app's own
  language instead of showing the server's English `Intl` string.
- The edit-employee sheet's sales-target field has a leading symbol
  (`target`) like every other field, and the phone field's placeholder
  matches the create sheet's (`+962 7 0000 0000`).
- The receipt sheet's button reads "Save amount", its field "Amount on the
  receipt", and the row amount uses `.neonNumberSmall` in
  `.neonSuccessStrong` instead of a hand-set system font. The critique
  couldn't screenshot the sheet itself (no receipt existed in the demo
  data this pass runs against) — that's a data/tooling gap, not something
  fixable from source, so it's left as a known gap in what could be
  visually re-verified.
- The password sheet opens at `.medium` (was `.large`, mostly empty), and
  shows an "At least 8 characters" error once the typed password is 1–7
  characters.

### What's still explained rather than fixed, and why

Issue 4 above is the only one not fully resolved, and it stays that way for
a concrete reason: the fix needs data the phone's API doesn't send
(`accessRole`) or a query change on the server (`team/employees` in
`src/lib/mobile/registry/team.ts`), and this pass's rules are "Edit only
`ios/Sources/Features/Team/*`, `ios/Resources/ar.lproj/Team.strings`, and
`ios/redesign/team.md`... No server changes." Everything else the critique
raised was fixable from inside those files, and is fixed.
