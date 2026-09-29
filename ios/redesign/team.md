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
| `team-employee` | `EmployeeDetailView` | Anchors `profile`, `day-plan`, `sales`, `performance`, `warnings`, `access`. |
| `team-payroll` | `PayrollRootView` | Anchors `totals`, `paysheet`, `salaries`, `attendance`, `receipts`. |
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
    attendance list and receipts list are visually unchanged — they already
    matched the kit's patterns (`SectionHeader` above a run of cards/`CardList`
    is the *allowed* case, not the anti-pattern).
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
